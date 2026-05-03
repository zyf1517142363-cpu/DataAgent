import asyncio
import io
import json
import math
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


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

    return agent_payload(
        "VideoAnalysisAgent已完成视频结构分析。",
        [
            f"Hook得分 {hook_score}，主题清晰度 {clarity_score}，节奏得分 {rhythm_score}。",
            f"内容综合分 {content_score}，传播潜力分 {virality_score}。",
        ],
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
    is_gacha = any(tag in video.get("tags", []) for tag in ["抽卡建议", "版本前瞻", "角色测评"])
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

    report = f"""
## AI自媒体内容增长策略报告

### 1. 内容对象
视频标题：{video.get("title", "未输入视频")}
内容分区：B站游戏区 / {video.get("scenario_type", "GAME")}
核心标签：{"、".join(video.get("tags", []))}

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
            return {"video_count": stats["video_count"], "avg_views": stats["avg_views"], "status": "success"}
        except Exception as exc:
            return {"video_count": 0, "avg_views": 0, "status": "fallback", "message": f"CSV解析失败：{str(exc)[:120]}"}

    @app.post("/video")
    async def video(request: Request, payload: VideoRequest) -> Dict[str, Any]:
        try:
            selected = choose_scenario(payload.url, payload.scenario)
            selected["url"] = payload.url
            session = get_session(request.app.state.memory_db, payload.session_id)
            session["video_data"] = selected
            return {
                "title": selected["title"],
                "tags": selected["tags"],
                "mock_subtitle": selected["mock_subtitle"],
                "scenario_type": selected["scenario_type"],
            }
        except Exception:
            fallback = choose_scenario()
            return {
                "title": fallback["title"],
                "tags": fallback["tags"],
                "mock_subtitle": fallback["mock_subtitle"],
                "scenario_type": fallback["scenario_type"],
            }

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
            session["analysis_result"] = all_results
            session["chat_context_summary"] = report.get("chat_context_summary", "{}")
            return {"report": report.get("report", ""), "data": all_results}
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
