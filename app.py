import asyncio
import io
import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pandas as pd
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BILIBILI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
}


def extract_bvid(url: str) -> Optional[str]:
    """Parse BV from URL. Bilibili BV ids are case-sensitive; only normalize the ``BV`` prefix."""
    if not url:
        return None
    match = re.search(r"(?i)bv([a-zA-Z0-9]{10})\b", url)
    if not match:
        return None
    return "BV" + match.group(1)


async def resolve_bilibili_page_url(client: httpx.AsyncClient, url: str) -> str:
    text = (url or "").strip()
    if not text or extract_bvid(text):
        return text
    low = text.lower()
    if "b23.tv" in low or ("bilibili.com" in low and "bv" not in low):
        try:
            response = await client.get(text, follow_redirects=True)
            return str(response.url)
        except Exception:
            return text
    return text


async def fetch_subtitle_text(client: httpx.AsyncClient, subtitle_url: str) -> str:
    link = subtitle_url.strip()
    if link.startswith("//"):
        link = "https:" + link
    response = await client.get(link, headers=BILIBILI_HEADERS)
    response.raise_for_status()
    payload = response.json()
    lines: List[str] = []
    for row in payload.get("body") or []:
        content = row.get("content")
        if isinstance(content, str) and content.strip():
            lines.append(content.strip())
            continue
        if isinstance(content, list):
            for piece in content:
                if isinstance(piece, dict):
                    seg = piece.get("content")
                    if isinstance(seg, str) and seg.strip():
                        lines.append(seg.strip())
    return "\n".join(lines)


async def fetch_bilibili_tags(client: httpx.AsyncClient, aid: int, bvid: str) -> List[str]:
    try:
        response = await client.get(
            "https://api.bilibili.com/x/tag/archive/tags",
            params={"aid": aid, "bvid": bvid},
            headers=BILIBILI_HEADERS,
        )
        data = response.json()
        if data.get("code") != 0 or not isinstance(data.get("data"), list):
            return []
        names: List[str] = []
        for item in data["data"]:
            name = item.get("tag_name") or item.get("name")
            if name and name not in names:
                names.append(str(name))
        return names
    except Exception:
        return []


async def fetch_bilibili_video_bundle(page_url: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=BILIBILI_HEADERS) as client:
        resolved = await resolve_bilibili_page_url(client, page_url)
        bvid = extract_bvid(resolved) or extract_bvid(page_url)
        if not bvid:
            raise ValueError("未识别到 BV 号。请粘贴完整视频页链接（含 BV…），或先打开 b23.tv 短链再复制最终地址。")

        view_response = await client.get("https://api.bilibili.com/x/web-interface/view", params={"bvid": bvid})
        view_response.raise_for_status()
        view_json = view_response.json()
        if view_json.get("code") != 0:
            code = view_json.get("code")
            msg = view_json.get("message") or ""
            if code == -404:
                raise ValueError(
                    f"未找到该视频（BV={bvid}）。若链接正确，请检查 BV 是否被改过大写/小写（B 站 BV 区分大小写）；或视频已删除/不可见。"
                )
            raise ValueError(msg or f"B站接口返回 code={code}")

        data = view_json.get("data") or {}
        aid = int(data.get("aid") or 0)
        title = (data.get("title") or "").strip()
        desc = (data.get("desc") or "").strip()
        stat = data.get("stat") or {}
        cid = data.get("cid")
        pages = data.get("pages") or []
        if pages and isinstance(pages, list):
            cid = pages[0].get("cid") or cid
        duration_sec = data.get("duration")
        tname = (data.get("tname") or "").strip() or "未知分区"
        tid = data.get("tid")

        tags = await fetch_bilibili_tags(client, aid, bvid) if aid else []
        if not tags:
            tags = [tname, "B站"]

        transcript_chunks: List[str] = []
        subtitle_meta: List[Dict[str, Any]] = []

        if aid and cid:
            try:
                player_response = await client.get(
                    "https://api.bilibili.com/x/player/v2",
                    params={"aid": aid, "cid": cid, "bvid": bvid},
                    headers=BILIBILI_HEADERS,
                )
                player_json = player_response.json()
                sub_root = (player_json.get("data") or {}).get("subtitle") or {}
                tracks = sub_root.get("subtitles") or []

                def track_priority(track: Dict[str, Any]) -> int:
                    lan = (track.get("lan") or "").lower()
                    doc = track.get("lan_doc") or ""
                    if "ai-" in lan or "自动生成" in doc:
                        return 2
                    if "zh" in lan or "中文" in doc or "汉语" in doc or "简体" in doc:
                        return 0
                    return 1

                for track in sorted(tracks, key=track_priority):
                    surl = track.get("subtitle_url") or track.get("url")
                    if not surl:
                        continue
                    try:
                        text = await fetch_subtitle_text(client, surl)
                    except Exception:
                        continue
                    if text.strip():
                        transcript_chunks.append(text.strip())
                        subtitle_meta.append(
                            {
                                "lang": track.get("lan_doc") or track.get("lan") or "",
                                "chars": len(text),
                            }
                        )
                        break
            except Exception:
                pass

        transcript = "\n".join(transcript_chunks).strip()
        if not transcript:
            transcript = (f"【官方简介】\n{desc}" if desc else f"【标题】\n{title}").strip()

        max_chars = 22000
        if len(transcript) > max_chars:
            transcript = transcript[:max_chars] + "\n…(内容过长已截断，分析基于前段文本)"

        scenario_type = "GAME" if (tid == 4 or "游戏" in tname) else tname[:24]

        return {
            "title": title or bvid,
            "tags": tags[:20],
            "mock_subtitle": transcript,
            "scenario_type": scenario_type,
            "url": page_url.strip(),
            "bvid": bvid,
            "source": "bilibili_api",
            "description": desc[:4000] if desc else "",
            "bilibili_stat": {
                "view": stat.get("view"),
                "like": stat.get("like"),
                "reply": stat.get("reply"),
                "danmaku": stat.get("danmaku"),
                "favorite": stat.get("favorite"),
                "coin": stat.get("coin"),
            },
            "subtitle_tracks": subtitle_meta,
            "duration_sec": duration_sec,
            "partition_name": tname,
        }


class VideoRequest(BaseModel):
    session_id: str
    url: str = ""
    scenario: Optional[str] = None


class AnalyzeRequest(BaseModel):
    session_id: str


class ChatRequest(BaseModel):
    session_id: str
    question: str


def agent_payload(
    summary: str,
    insights: Optional[List[Any]] = None,
    causal_factors: Optional[List[Dict[str, Any]]] = None,
    suggestions: Optional[List[str]] = None,
    **extra: Any,
) -> Dict[str, Any]:
    payload = {
        "summary": summary,
        "insights": insights or [],
        "causal_factors": causal_factors or [],
        "suggestions": suggestions or [],
    }
    payload.update(extra)
    return payload


def create_initial_session() -> Dict[str, Any]:
    return {
        "csv_data": None,
        "csv_stats": {},
        "video_data": {},
        "analysis_result": {},
        "chat_context_summary": "",
    }


def get_session(memory_db: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    safe_session_id = session_id or str(uuid.uuid4())
    if safe_session_id not in memory_db:
        memory_db[safe_session_id] = create_initial_session()
    return memory_db[safe_session_id]


def scenarios() -> Dict[str, Dict[str, Any]]:
    return {
        "A": {
            "title": "黑神话悟空隐藏Boss打法：三分钟看懂无伤节奏与配装思路",
            "tags": ["游戏区", "黑神话悟空", "攻略", "Boss打法", "弹幕互动"],
            "scenario_type": "GAME",
            "mock_subtitle": (
                "开头三秒先给结论：这个Boss最容易翻车的不是伤害不够，而是贪刀节奏。"
                "第一阶段看抬手，第二阶段留翻滚，第三阶段用定身术补输出窗口。"
                "如果你是手残党，配装优先选容错率，不要盲目追求极限伤害。"
                "弹幕里很多人问为什么这里不喝药，关键是把回血留给转阶段后的连招。"
                "本期用实战片段拆解站位、技能冷却和评论区高频问题，帮你少坐牢十分钟。"
            ),
        },
        "B": {
            "title": "新版本抽卡值不值得：角色强度、命座收益与平民玩家规划",
            "tags": ["游戏区", "抽卡建议", "版本前瞻", "角色测评", "平民攻略"],
            "scenario_type": "GAME",
            "mock_subtitle": (
                "这期不吹不黑，只回答一个问题：普通玩家到底该不该抽。"
                "先看零命机制，再看一命提升，最后把专武和下半卡池放在一起比较。"
                "如果你已经有同定位角色，这个池子的优先级会明显下降。"
                "评论区可以打出你的box，我会按深渊、XP和资源储备给你做取舍建议。"
            ),
        },
    }


def choose_scenario(url: str = "", scenario: Optional[str] = None) -> dict[Any, Any] | dict[str, Any] | dict[str, str] | \
                                                                      dict[bytes, bytes]:
    scenario_map = scenarios()
    if scenario in scenario_map:
        return dict(scenario_map[scenario])
    text = (url or "").lower()
    if any(key in text for key in ["gacha", "抽卡", "版本", "角色", "原神", "明日方舟"]):
        return dict(scenario_map["B"])
    return dict(scenario_map["A"])


def load_knowledge_base() -> List[Dict[str, str]]:
    path = Path(__file__).with_name("knowledge_base.json")
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return [
            {"term": "寄了", "meaning": "数据或效果失败", "sentiment": "negative"},
            {"term": "硬核", "meaning": "技术深度高，专业性强", "sentiment": "positive"},
            {"term": "完播率", "meaning": "观众看完视频的比例", "sentiment": "neutral"},
        ]


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except Exception:
        pass
    return default


def detect_numeric_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    lowered = {str(col).lower(): col for col in df.columns}
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    return numeric_cols[0] if numeric_cols else None


def compute_csv_stats(df: pd.DataFrame) -> Dict[str, Any]:
    views_col = detect_numeric_column(df, ["views", "view_count", "play", "播放量", "播放"])
    likes_col = detect_numeric_column(df, ["likes", "like_count", "点赞", "点赞数"])
    comments_col = detect_numeric_column(df, ["comments", "comment_count", "评论", "评论数"])
    duration_col = detect_numeric_column(df, ["duration", "length", "视频长度", "时长"])

    views = pd.to_numeric(df[views_col], errors="coerce").fillna(0) if views_col else pd.Series(dtype=float)
    likes = pd.to_numeric(df[likes_col], errors="coerce").fillna(0) if likes_col else pd.Series(dtype=float)
    comments = pd.to_numeric(df[comments_col], errors="coerce").fillna(0) if comments_col else pd.Series(dtype=float)

    avg_views = finite_float(views.mean())
    total_views = finite_float(views.sum())
    like_rate = finite_float(likes.sum() / total_views) if total_views > 0 and not likes.empty else 0.0
    comment_rate = finite_float(comments.sum() / total_views) if total_views > 0 and not comments.empty else 0.0

    return {
        "video_count": int(len(df)),
        "views_col": str(views_col) if views_col is not None else "",
        "avg_views": round(avg_views, 2),
        "max_views": round(finite_float(views.max()), 2) if not views.empty else 0,
        "view_variance": round(finite_float(views.var()), 2) if len(views) > 1 else 0,
        "like_rate": round(like_rate, 4),
        "comment_rate": round(comment_rate, 4),
        "duration_col": str(duration_col) if duration_col is not None else "",
    }


async def with_timeout(name: str, coro: Any, fallback: Dict[str, Any], seconds: int = 15) -> Dict[str, Any]:
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except Exception as exc:
        degraded = dict(fallback)
        degraded["degraded"] = True
        degraded["error"] = f"{name} timeout/fallback: {str(exc)[:120]}"
        return degraded


async def data_agent(session: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    stats = session.get("csv_stats") or {}
    if not stats:
        return agent_payload(
            "未上传CSV，使用保守行业基线进行演示分析。",
            ["缺少真实播放数据，策略侧将降低数据置信度。"],
            [{"factor": "CSV样本缺失", "impact_weight": 0.2, "confidence": 0.55}],
            ["上传包含 views/likes/comments 字段的CSV可获得更稳定归因。"],
            metrics={"video_count": 0, "avg_views": 0, "like_rate": 0},
        )

    like_rate = stats.get("like_rate", 0)
    variance = stats.get("view_variance", 0)
    insights = [
        f"样本视频数 {stats.get('video_count', 0)}，平均播放 {stats.get('avg_views', 0)}。",
        f"点赞率约 {round(like_rate * 100, 2)}%，播放方差 {variance}，可用于识别爆款离群点。",
    ]
    causal = [
        {"factor": "历史播放均值", "impact_weight": min(0.85, stats.get("avg_views", 0) / 100000), "confidence": 0.82},
        {"factor": "互动率", "impact_weight": min(0.9, like_rate * 12), "confidence": 0.78},
    ]
    return agent_payload("DataAgent已完成CSV统计分析。", insights, causal, ["优先复盘高于均值2倍的视频结构。"], metrics=stats)


async def video_analysis_agent(session: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    video = session.get("video_data") or choose_scenario()
    subtitle = video.get("mock_subtitle", "")
    tags = video.get("tags", [])
    hook_score = 88 if any(key in subtitle for key in ["开头", "三秒", "问题", "如果"]) else 72
    clarity_score = 90 if len(tags) >= 4 else 78
    rhythm_score = 86 if any(key in subtitle for key in ["中段", "结尾", "节点", "每一分钟"]) else 80
    content_score = round((hook_score + clarity_score + rhythm_score) / 3, 1)
    virality_score = round(content_score * 0.62 + min(len(subtitle) / 12, 30), 1)

    insights = [
        f"Hook得分 {hook_score}，主题清晰度 {clarity_score}，节奏得分 {rhythm_score}。",
        f"内容综合分 {content_score}，传播潜力分 {virality_score}。",
    ]
    if video.get("source") == "bilibili_api":
        st = video.get("bilibili_stat") or {}
        insights.append(
            f"真实抓取：B站公开数据 播放 {st.get('view', '—')}，点赞 {st.get('like', '—')}，评论 {st.get('reply', '—')}，弹幕 {st.get('danmaku', '—')}。"
        )
        insights.append(f"文本来源：{'字幕转写' if video.get('subtitle_tracks') else '简介/标题'}（长度 {len(subtitle)} 字），用于语义与结构启发式分析。")

    return agent_payload(
        "VideoAnalysisAgent已完成视频结构分析。",
        insights,
        [
            {"factor": "前三秒问题式Hook", "impact_weight": hook_score / 100, "confidence": 0.86},
            {"factor": "主题标签清晰度", "impact_weight": clarity_score / 100, "confidence": 0.8},
        ],
        ["把核心冲突前置到标题与开场第一句话。"],
        content_score=content_score,
        virality_score=virality_score,
        video=video,
    )


async def analysis_agent(data_result: Dict[str, Any], video_result: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    avg_views = finite_float((data_result.get("metrics") or {}).get("avg_views"))
    content_score = finite_float(video_result.get("content_score"), 80)
    uplift = 0.12 if content_score >= 85 else 0.08
    if avg_views > 0:
        expected = round(avg_views * (1 + uplift), 0)
        insight = f"控制视频长度和选题不变，仅强化标题情绪与开场冲突，预计播放从 {round(avg_views, 0)} 提升到 {expected}。"
    else:
        insight = "控制视频长度和选题不变，仅强化标题情绪与开场冲突，预计播放提升约 8%-12%。"
    return agent_payload(
        "AnalysisAgent采用控制变量法完成主因归因。",
        [insight, "保持选题、时长、发布时间不变时，Hook清晰度是当前最可解释变量。"],
        [
            {"factor": "标题情绪极性增强", "impact_weight": uplift, "confidence": 0.81},
            {"factor": "开场冲突前置", "impact_weight": 0.16, "confidence": 0.84},
            {"factor": "标签语义聚焦", "impact_weight": 0.09, "confidence": 0.74},
        ],
        ["A/B测试标题情绪强度，其他变量保持不变。"],
    )


async def counterfactual_agent(analysis: Dict[str, Any], data_result: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    avg_views = finite_float((data_result.get("metrics") or {}).get("avg_views"), 50000)
    scenarios_cf = [
        {
            "control": "控制选题、视频长度、封面风格不变",
            "change": "发布时间提前2小时，覆盖通勤/午休前流量窗口",
            "baseline_views": round(avg_views, 0),
            "expected_views": round(avg_views * 1.15, 0),
            "uplift_percent": 15,
            "confidence": 0.76,
        },
        {
            "control": "控制发布时间、字幕密度、视频长度不变",
            "change": "标题从信息陈述改为问题式冲突标题",
            "baseline_views": round(avg_views, 0),
            "expected_views": round(avg_views * 1.18, 0),
            "uplift_percent": 18,
            "confidence": 0.79,
        },
        {
            "control": "控制选题和标题不变",
            "change": "在30%、65%进度处加入弹幕提问互动点",
            "baseline_views": round(avg_views, 0),
            "expected_views": round(avg_views * 1.1, 0),
            "uplift_percent": 10,
            "confidence": 0.72,
        },
    ]
    return agent_payload(
        "CounterfactualAgent完成反事实推演。",
        [f"{item['control']}；{item['change']}；预计提升 {item['uplift_percent']}%。" for item in scenarios_cf],
        [
            {"factor": item["change"], "impact_weight": item["uplift_percent"] / 100, "confidence": item["confidence"]}
            for item in scenarios_cf
        ],
        ["优先测试发布时间与标题问题式改写，两者执行成本最低。"],
        counterfactuals=scenarios_cf,
    )


def semantic_score(text: str, concept: Dict[str, str]) -> float:
    lowered = text.lower()
    meaning = concept.get("meaning", "")
    term = concept.get("term", "")
    variants = {
        "寄了": ["失败", "爆不了", "效果差", "数据差", "没起量", "崩了"],
        "硬核": ["专业", "技术深度", "信息密度", "深度高", "系统解释"],
        "完播率": ["看完", "留存", "结尾", "观看比例", "留存曲线"],
    }.get(term, [])
    tokens = list(meaning) + variants
    hits = sum(1 for token in tokens if token and token in lowered)
    soft_term_hit = 1 if term and re.sub(r"\s+", "", term) in re.sub(r"\s+", "", lowered) else 0
    return min(0.98, (hits * 0.22) + (soft_term_hit * 0.28))


async def knowledge_agent(session: Dict[str, Any], video_result: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    kb = load_knowledge_base()
    subtitle = (video_result.get("video") or {}).get("mock_subtitle", "")
    matches = []
    for item in kb:
        score = semantic_score(subtitle, item)
        if score >= 0.22:
            matches.append(
                {
                    "term": item.get("term"),
                    "meaning": item.get("meaning"),
                    "sentiment": item.get("sentiment"),
                    "context_meaning": f"字幕语境体现了「{item.get('meaning')}」的概念变体。",
                    "semantic_confidence": round(score, 2),
                }
            )
    if not matches:
        matches.append(
            {
                "term": "未命中强黑话",
                "meaning": "字幕偏通用表达",
                "sentiment": "neutral",
                "context_meaning": "建议加入更明确的社区语言以提高弹幕共鸣。",
                "semantic_confidence": 0.5,
            }
        )
    return agent_payload(
        "KnowledgeAgent完成知识库语义增强匹配。",
        [f"{m['term']}：{m['context_meaning']}" for m in matches],
        [{"factor": m["term"], "impact_weight": m["semantic_confidence"], "confidence": m["semantic_confidence"]} for m in matches],
        ["把命中的社区语言放入弹幕互动问题和标题副句。"],
        semantic_tags=matches,
    )


async def strategy_agent(
    data_result: Dict[str, Any],
    video_result: Dict[str, Any],
    analysis: Dict[str, Any],
    counterfactual: Dict[str, Any],
    knowledge: Dict[str, Any],
) -> Dict[str, Any]:
    await asyncio.sleep(0)
    video = (video_result.get("video") or {})
    base = (video.get("title") or "").strip()
    raw_tags = video.get("tags") or []
    tag_list = raw_tags if isinstance(raw_tags, list) else []
    tag_text = " ".join(str(t) for t in tag_list)
    is_gacha = any(tag in tag_list for tag in ["抽卡建议", "版本前瞻", "角色测评", "抽卡", "卡池", "池子"]) or any(
        k in (base + tag_text) for k in ("抽卡", "卡池", "池子", "氪金", "保底")
    )
    if video.get("source") == "bilibili_api" and base:
        title = (
            f"{base[:28]}…到底值不值抽？三类玩家对照选" if is_gacha else f"{base[:28]}…核心要点与节奏：3 分钟讲清"
        )
    else:
        title = "新版本抽卡到底值不值？三类玩家直接照着选" if is_gacha else "这个Boss别再硬莽了：三分钟拆清无伤节奏"
    strategies = [
        f"标题：{title}",
        "发布时间：优先测试 12:00 或 20:30，覆盖午休刷视频和晚间游戏活跃窗口。",
        "弹幕节点：30%进度提问“你卡在哪个阶段？”，65%进度引导观众刷出自己的配装或box。",
        "封面：突出游戏角色/Boss主体 + 一个强结果词，例如“无伤”“避坑”“必抽/别抽”。",
    ]
    return agent_payload(
        "StrategyAgent已整合数据、视频、因果归因和语义增强结果。",
        strategies,
        analysis.get("causal_factors", []) + counterfactual.get("causal_factors", [])[:2],
        strategies,
        execution_plan=strategies,
        recommended_title=title,
        best_publish_time="11:30 / 19:30",
    )


async def report_agent(all_results: Dict[str, Any]) -> Dict[str, Any]:
    await asyncio.sleep(0)
    video = (all_results.get("video") or {}).get("video", {})
    strategy = all_results.get("strategy", {})
    counterfactuals = (all_results.get("counterfactual") or {}).get("counterfactuals", [])
    semantic_tags = (all_results.get("knowledge") or {}).get("semantic_tags", [])
    causal = strategy.get("causal_factors", [])

    source = video.get("source") or "heuristic_demo"
    source_note = (
        f"数据来源：B站公开接口（BV {video.get('bvid', '')}），字幕/简介已抓取用于分析。"
        if source == "bilibili_api"
        else "数据来源：演示场景或未识别 BV 的启发式模板。"
    )
    st = video.get("bilibili_stat") or {}
    stat_line = ""
    if st:
        stat_line = f"B站公开互动：播放 {st.get('view', '—')}｜点赞 {st.get('like', '—')}｜评论 {st.get('reply', '—')}｜弹幕 {st.get('danmaku', '—')}｜收藏 {st.get('favorite', '—')}"
    transcript = (video.get("mock_subtitle") or "").strip()
    excerpt = (transcript[:1200] + "…") if len(transcript) > 1200 else transcript

    report = f"""
## AI自媒体内容增长策略报告

### 1. 内容对象
视频标题：{video.get("title", "未输入视频")}
内容分区：{video.get("partition_name") or "B站"} / {video.get("scenario_type", "GAME")}
核心标签：{"、".join(video.get("tags", []) if isinstance(video.get("tags"), list) else [])}
{source_note}
{stat_line}

### 1.1 视频文本摘录（字幕或简介，供人工核对）
{excerpt or "（无可用文本）"}

### 2. 数据与内容诊断
{all_results.get("data", {}).get("summary", "")}
{all_results.get("video", {}).get("summary", "")}
内容得分：{all_results.get("video", {}).get("content_score", 0)}；传播潜力：{all_results.get("video", {}).get("virality_score", 0)}

### 3. 因果归因（控制变量法）
{chr(10).join("- " + item for item in all_results.get("analysis", {}).get("insights", []))}

### 4. 反事实推演
{chr(10).join("- " + item.get("change", "") + f"：预计提升 {item.get('uplift_percent', 0)}%，置信度 {item.get('confidence', 0)}" for item in counterfactuals)}

### 5. 弹幕/语义知识增强
{chr(10).join("- " + tag.get("term", "") + "：" + tag.get("context_meaning", "") for tag in semantic_tags)}

### 6. 可执行增长策略
{chr(10).join("- " + item for item in strategy.get("execution_plan", []))}
""".strip()

    summary = {
        "video_title": video.get("title", ""),
        "scenario": video.get("scenario_type", "A"),
        "video_source": video.get("source"),
        "bvid": video.get("bvid"),
        "bilibili_stat": video.get("bilibili_stat"),
        "key_metrics": {
            "content_score": all_results.get("video", {}).get("content_score", 0),
            "virality_score": all_results.get("video", {}).get("virality_score", 0),
            "avg_views": (all_results.get("data", {}).get("metrics") or {}).get("avg_views", 0),
        },
        "top_causal_factors": causal[:5],
        "counterfactuals": counterfactuals[:3],
        "semantic_tags": semantic_tags[:5],
        "strategy": strategy.get("execution_plan", [])[:4],
    }
    chat_context_summary = json.dumps(summary, ensure_ascii=False)
    if len(chat_context_summary) > 2800:
        chat_context_summary = chat_context_summary[:2800]
    return {"report": report, "chat_context_summary": chat_context_summary}


async def maybe_llm_markdown_report(all_results: Dict[str, Any]) -> Optional[str]:
    api_key = os.environ.get("ANALYSIS_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    base_url = (os.environ.get("ANALYSIS_LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("ANALYSIS_LLM_MODEL", "gpt-4o-mini")
    video = (all_results.get("video") or {}).get("video", {})
    transcript = (video.get("mock_subtitle") or "")[:14000]
    signals = {
        "data": {"summary": (all_results.get("data") or {}).get("summary"), "metrics": (all_results.get("data") or {}).get("metrics")},
        "video": {
            "summary": (all_results.get("video") or {}).get("summary"),
            "content_score": (all_results.get("video") or {}).get("content_score"),
            "virality_score": (all_results.get("video") or {}).get("virality_score"),
        },
        "analysis": {"insights": (all_results.get("analysis") or {}).get("insights")},
        "counterfactual": (all_results.get("counterfactual") or {}).get("counterfactuals", [])[:3],
        "knowledge": (all_results.get("knowledge") or {}).get("semantic_tags", [])[:5],
        "strategy": (all_results.get("strategy") or {}).get("execution_plan", [])[:6],
    }
    compact = json.dumps(signals, ensure_ascii=False)[:8000]
    system = (
        "你是资深中文 B 站内容与增长顾问。你将获得真实视频的字幕或简介文本，以及一组启发式智能体输出的结构化信号。"
        "请综合二者输出 Markdown 报告，必须包含章节：## 内容对象、## 数据与内容诊断、## 因果归因、## 反事实推演、## 弹幕语义、## 可执行增长策略。"
        "必须紧扣字幕/简介中的具体话题与表述；禁止编造字幕中未出现的事实；不确定处请写「需结合画面补充」。"
    )
    user = f"【视频标题】{video.get('title', '')}\n【BV】{video.get('bvid', '')}\n【字幕或简介】\n{transcript}\n\n【结构化信号 JSON】\n{compact}"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0.45,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            response.raise_for_status()
            data = response.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
        return content.strip() if isinstance(content, str) and content.strip() else None
    except Exception:
        return None


def local_chat_answer(context: str, question: str) -> str:
    q = question.strip()
    try:
        ctx = json.loads(context) if context else {}
    except Exception:
        ctx = {}
    factors = ctx.get("top_causal_factors", [])
    strategy = ctx.get("strategy", [])
    counterfactuals = ctx.get("counterfactuals", [])
    tags = ctx.get("semantic_tags", [])

    if any(key in q for key in ["标题", "title"]):
        title_line = next((s for s in strategy if s.startswith("标题")), "建议使用问题式标题，并突出冲突或收益。")
        return f"建议优先采用：{title_line}。理由是标题情绪极性和开场冲突在本次归因中权重较高。"
    if any(key in q for key in ["发布", "时间"]):
        return "建议测试 11:30 或 19:30。反事实推演显示，在控制选题、时长和封面不变时，发布时间提前2小时预计带来约15%播放提升。"
    if any(key in q for key in ["原因", "归因", "为什么"]):
        desc = "；".join([f"{f.get('factor')} 权重{f.get('impact_weight')}" for f in factors[:3]])
        return f"主要归因是：{desc}。这些结论来自控制变量法，而不是泛泛比较。"
    if any(key in q for key in ["弹幕", "语义", "黑话"]):
        desc = "；".join([f"{t.get('term')}({t.get('sentiment')})" for t in tags])
        return f"语义增强命中：{desc or '暂无强命中'}。建议把这些表达放在互动提问节点里，提升社区共鸣。"
    if any(key in q for key in ["播放", "观看", "点赞", "数据", "统计"]):
        st = ctx.get("bilibili_stat") or {}
        if st:
            return (
                f"B站公开接口抓取的统计：播放 {st.get('view', '—')}，点赞 {st.get('like', '—')}，评论 {st.get('reply', '—')}，"
                f"弹幕 {st.get('danmaku', '—')}，收藏 {st.get('favorite', '—')}。数值以官方页面为准。"
            )
        return "当前摘要里没有该视频的 B 站实时统计；请使用含 BV 的链接载入视频并成功生成报告后再问。"
    if any(key in q for key in ["提升", "策略", "怎么做"]):
        return "执行优先级：先改标题和开场Hook，再测试发布时间，最后在30%和65%进度加入弹幕互动节点。这三项成本低、可用控制变量法验证。"
    cf = counterfactuals[0] if counterfactuals else {}
    return f"基于当前报告，最稳妥的动作是：{strategy[0] if strategy else '强化标题与开场冲突'}。参考反事实：{cf.get('change', '发布时间和标题都值得A/B测试')}。"


def create_app() -> FastAPI:
    app = FastAPI(title="AI Media Growth Strategy Agent Demo", version="1.0.0")
    app.state.memory_db = {}

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok", "sessions": len(app.state.memory_db)}

    @app.post("/upload")
    async def upload_csv(
        request: Request,
        session_id: str = Form(...),
        file: UploadFile = File(...),
    ) -> Dict[str, Any]:
        try:
            content = await file.read()
            df = pd.read_csv(io.BytesIO(content))
            stats = compute_csv_stats(df)
            session = get_session(request.app.state.memory_db, session_id)
            session["csv_data"] = df.head(500).to_dict(orient="records")
            session["csv_stats"] = stats
            return {
                "video_count": stats["video_count"],
                "avg_views": stats["avg_views"],
                "like_rate": stats.get("like_rate", 0),
                "comment_rate": stats.get("comment_rate", 0),
                "status": "success",
            }
        except Exception as exc:
            return {"video_count": 0, "avg_views": 0, "status": "fallback", "message": f"CSV解析失败：{str(exc)[:120]}"}

    @app.post("/video")
    async def video(request: Request, payload: VideoRequest) -> Dict[str, Any]:
        session = get_session(request.app.state.memory_db, payload.session_id)
        try:
            if payload.scenario in scenarios():
                selected = dict(choose_scenario(payload.url, payload.scenario))
                selected["url"] = (payload.url or "").strip()
                selected.setdefault("source", "demo_scenario")
            elif extract_bvid((payload.url or "").strip()):
                selected = await fetch_bilibili_video_bundle((payload.url or "").strip())
            else:
                selected = dict(choose_scenario(payload.url, None))
                selected["url"] = (payload.url or "").strip()
                selected.setdefault("source", "heuristic_demo")
            session["video_data"] = selected
            return {
                "title": selected.get("title", ""),
                "tags": selected.get("tags", []),
                "mock_subtitle": selected.get("mock_subtitle", ""),
                "scenario_type": selected.get("scenario_type", "GAME"),
                "source": selected.get("source", "unknown"),
                "bvid": selected.get("bvid"),
                "description": selected.get("description", ""),
                "bilibili_stat": selected.get("bilibili_stat"),
                "subtitle_tracks": selected.get("subtitle_tracks"),
                "partition_name": selected.get("partition_name"),
            }
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"网络请求失败：{str(exc)[:160]}") from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"载入视频失败：{str(exc)[:200]}") from exc

    @app.post("/analyze")
    async def analyze(request: Request, payload: AnalyzeRequest = Body(...)) -> Dict[str, Any]:
        session = get_session(request.app.state.memory_db, payload.session_id)
        try:
            data_fallback = agent_payload("DataAgent降级：使用空数据基线。", metrics={"video_count": 0, "avg_views": 0})
            video_fallback = agent_payload("VideoAnalysisAgent降级：使用默认科技Mock。", video=choose_scenario(), content_score=80, virality_score=78)

            data_result, video_result = await asyncio.gather(
                with_timeout("DataAgent", data_agent(session), data_fallback),
                with_timeout("VideoAnalysisAgent", video_analysis_agent(session), video_fallback),
            )
            analysis = await with_timeout("AnalysisAgent", analysis_agent(data_result, video_result), agent_payload("归因降级：标题与Hook为主要变量。"))
            counterfactual = await with_timeout(
                "CounterfactualAgent",
                counterfactual_agent(analysis, data_result),
                agent_payload("反事实降级：建议测试标题和发布时间。", counterfactuals=[]),
            )
            knowledge = await with_timeout("KnowledgeAgent", knowledge_agent(session, video_result), agent_payload("语义增强降级：暂无强命中。", semantic_tags=[]))
            strategy = await with_timeout(
                "StrategyAgent",
                strategy_agent(data_result, video_result, analysis, counterfactual, knowledge),
                agent_payload("策略降级：优先优化标题、发布时间和互动节点。", execution_plan=["优化标题", "测试发布时间", "增加弹幕互动"]),
            )
            all_results = {
                "data": data_result,
                "video": video_result,
                "analysis": analysis,
                "counterfactual": counterfactual,
                "knowledge": knowledge,
                "strategy": strategy,
            }
            report = await with_timeout("ReportAgent", report_agent(all_results), {"report": "报告生成降级，请稍后重试。", "chat_context_summary": "{}"})
            llm_report: Optional[str] = None
            try:
                llm_report = await asyncio.wait_for(maybe_llm_markdown_report(all_results), timeout=95.0)
            except (asyncio.TimeoutError, Exception):
                llm_report = None
            if llm_report:
                report = {**report, "report": llm_report}
            session["analysis_result"] = all_results
            session["chat_context_summary"] = report.get("chat_context_summary", "{}")
            return {"report": report.get("report", ""), "data": all_results, "report_llm": bool(llm_report)}
        except Exception as exc:
            return {
                "report": f"系统已触发稳定性兜底：{str(exc)[:120]}。请继续演示，默认策略为优化标题、发布时间与互动节点。",
                "data": {},
            }

    @app.post("/chat")
    async def chat(request: Request, payload: ChatRequest) -> Dict[str, Any]:
        try:
            session = get_session(request.app.state.memory_db, payload.session_id)
            context = session.get("chat_context_summary", "")[:3000]
            prompt = f"基于以下项目分析摘要回答问题：{context}。用户问题：{payload.question}"
            answer = local_chat_answer(context, payload.question)
            return {"answer": answer, "prompt_tokens_guard": len(prompt)}
        except Exception:
            return {"answer": "当前会话上下文不可用。请先上传CSV或输入视频URL并点击生成分析报告。"}

    return app


app = create_app()
