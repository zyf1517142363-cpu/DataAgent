import http from "node:http";

const memoryDb = {};

const scenarioA = {
  title: "从数据湖到AI Agent：大数据系统如何支撑下一代内容增长",
  tags: ["AI", "大数据", "技术科普", "Agent", "增长策略"],
  scenario_type: "A",
  mock_subtitle:
    "开头三秒我们直接看一个问题：为什么同样是AI选题，有的视频爆了，有的却寄了。答案不只在标题，而在数据链路、完播率、互动节点和因果归因。真正硬核的地方，是把弹幕语义、标题情绪和留存曲线放进同一个分析框架。",
};

const scenarioB = {
  title: "伊朗三千年历史脉络：帝国、信仰与地缘叙事",
  tags: ["历史", "人文", "伊朗", "叙事", "文明"],
  scenario_type: "B",
  mock_subtitle:
    "如果用十分钟理解伊朗三千年，我们不能只看战争，还要看高原、商路和信仰。从波斯帝国到萨珊王朝，再到现代地缘格局，真正吸引观众的是命运转折。",
};

function getSession(sessionId) {
  if (!memoryDb[sessionId]) {
    memoryDb[sessionId] = {
      csv_data: null,
      video_data: {},
      analysis_result: {},
      chat_context_summary: "",
      csv_stats: { video_count: 0, avg_views: 0, like_rate: 0 },
    };
  }
  return memoryDb[sessionId];
}

function chooseScenario(url = "", scenario = "") {
  const text = String(url).toLowerCase();
  if (scenario === "B" || /history|iran|伊朗|历史|波斯/.test(text)) return { ...scenarioB };
  return { ...scenarioA };
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function parseUpload(buffer, contentType) {
  const text = buffer.toString("utf8");
  const sessionMatch = text.match(/name="session_id"\r?\n\r?\n([^\r\n]+)/);
  const sessionId = sessionMatch?.[1]?.trim() || "demo_session";
  const csvStart = text.indexOf("title,views");
  const csvText = csvStart >= 0 ? text.slice(csvStart).split(/\r?\n--/)[0] : "";
  const rows = csvText.trim().split(/\r?\n/).slice(1);
  const views = rows.map((row) => Number(row.split(",")[1] || 0)).filter(Number.isFinite);
  const likes = rows.map((row) => Number(row.split(",")[2] || 0)).filter(Number.isFinite);
  const avgViews = views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0;
  const likeRate = views.reduce((a, b) => a + b, 0) ? likes.reduce((a, b) => a + b, 0) / views.reduce((a, b) => a + b, 0) : 0;
  return { sessionId, stats: { video_count: views.length, avg_views: Math.round(avgViews), like_rate: Number(likeRate.toFixed(4)) } };
}

function buildAnalysis(session) {
  const video = Object.keys(session.video_data || {}).length ? session.video_data : scenarioA;
  const avgViews = session.csv_stats?.avg_views || 50000;
  const contentScore = video.scenario_type === "B" ? 86.5 : 91.2;
  const viralityScore = video.scenario_type === "B" ? 88.1 : 92.8;
  const semanticTags = [
    { term: "寄了", meaning: "数据或效果失败", sentiment: "negative", context_meaning: "字幕语境体现数据失败风险。", semantic_confidence: 0.72 },
    { term: "硬核", meaning: "技术深度高，专业性强", sentiment: "positive", context_meaning: "字幕强调专业深度和信息密度。", semantic_confidence: 0.86 },
    { term: "完播率", meaning: "观众看完视频的比例", sentiment: "neutral", context_meaning: "字幕涉及留存曲线和观看完成度。", semantic_confidence: 0.78 },
  ];
  const causal = [
    { factor: "标题情绪极性增强", impact_weight: 0.18, confidence: 0.79 },
    { factor: "开场冲突前置", impact_weight: 0.16, confidence: 0.84 },
    { factor: "发布时间提前2小时", impact_weight: 0.15, confidence: 0.76 },
    { factor: "弹幕互动节点", impact_weight: 0.1, confidence: 0.72 },
  ];
  const counterfactuals = [
    { control: "控制选题、视频长度、封面风格不变", change: "发布时间提前2小时", baseline_views: avgViews, expected_views: Math.round(avgViews * 1.15), uplift_percent: 15, confidence: 0.76 },
    { control: "控制发布时间、字幕密度、视频长度不变", change: "标题改为问题式冲突标题", baseline_views: avgViews, expected_views: Math.round(avgViews * 1.18), uplift_percent: 18, confidence: 0.79 },
  ];
  const strategy = [
    `标题：${video.scenario_type === "B" ? "三千年伊朗：为什么这个高原总在改变世界？" : "同样讲AI，为什么这条能爆？大数据增长系统拆解"}`,
    "发布时间：优先测试 11:30 或 19:30。",
    "弹幕节点：30%进度提问，65%进度引导预测结论。",
    "封面：一个强问题 + 一个核心对象。",
  ];
  const data = {
    data: { summary: "DataAgent已完成CSV统计分析。", metrics: session.csv_stats, causal_factors: causal.slice(0, 1), insights: [] },
    video: { summary: "VideoAnalysisAgent已完成视频结构分析。", content_score: contentScore, virality_score: viralityScore, video, causal_factors: causal.slice(1, 2), insights: [] },
    analysis: { summary: "AnalysisAgent采用控制变量法完成主因归因。", causal_factors: causal, insights: ["控制视频长度和选题不变，仅强化标题情绪与开场冲突，预计播放提升约15%-18%。"] },
    counterfactual: { summary: "CounterfactualAgent完成反事实推演。", counterfactuals, causal_factors: causal.slice(2), insights: [] },
    knowledge: { summary: "KnowledgeAgent完成知识库语义增强匹配。", semantic_tags: semanticTags, causal_factors: [], insights: [] },
    strategy: { summary: "StrategyAgent已整合结果。", execution_plan: strategy, causal_factors: causal, insights: strategy },
  };
  const report = `## AI自媒体内容增长策略报告

### 1. 内容对象
视频标题：${video.title}
场景类型：${video.scenario_type}
核心标签：${video.tags.join("、")}

### 2. 数据与内容诊断
样本视频数 ${session.csv_stats.video_count}，平均播放 ${session.csv_stats.avg_views}。
内容得分：${contentScore}；传播潜力：${viralityScore}

### 3. 因果归因（控制变量法）
- 控制视频长度和选题不变，标题改为问题式冲突标题，预计播放提升18%，置信度0.79。
- 控制选题、视频长度、封面风格不变，发布时间提前2小时，预计播放提升15%，置信度0.76。

### 4. 弹幕/语义知识增强
- 寄了：识别数据失败语义，适合用于反差表达。
- 硬核：识别专业深度语义，适合强调技术/叙事价值。
- 完播率：识别留存相关语义，可连接互动节点。

### 5. 可执行增长策略
${strategy.map((item) => `- ${item}`).join("\n")}`;
  session.analysis_result = data;
  session.chat_context_summary = JSON.stringify({ video_title: video.title, top_causal_factors: causal, counterfactuals, semantic_tags: semanticTags, strategy }).slice(0, 2800);
  return { report, data };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, {});
  try {
    if (req.url === "/health") return send(res, 200, { status: "ok", sessions: Object.keys(memoryDb).length });
    if (req.url === "/upload" && req.method === "POST") {
      const parsed = parseUpload(await readBody(req), req.headers["content-type"] || "");
      const session = getSession(parsed.sessionId);
      session.csv_stats = parsed.stats;
      return send(res, 200, { video_count: parsed.stats.video_count, avg_views: parsed.stats.avg_views, status: "success" });
    }
    if (req.url === "/video" && req.method === "POST") {
      const body = parseJson(await readBody(req));
      const video = chooseScenario(body.url, body.scenario);
      const session = getSession(body.session_id || "demo_session");
      session.video_data = video;
      return send(res, 200, video);
    }
    if (req.url === "/analyze" && req.method === "POST") {
      const body = parseJson(await readBody(req));
      return send(res, 200, buildAnalysis(getSession(body.session_id || "demo_session")));
    }
    if (req.url === "/chat" && req.method === "POST") {
      const body = parseJson(await readBody(req));
      const session = getSession(body.session_id || "demo_session");
      const q = body.question || "";
      const answer = /时间|发布/.test(q)
        ? "建议测试 11:30 或 19:30。反事实推演显示，在控制选题、时长和封面不变时，发布时间提前2小时预计带来约15%播放提升。"
        : /标题/.test(q)
          ? "建议使用问题式冲突标题，把核心收益或矛盾放到前半句，例如“同样讲AI，为什么这条能爆？”。"
          : /弹幕|语义|黑话/.test(q)
            ? "语义增强命中“寄了、硬核、完播率”。建议把这些社区表达放入30%和65%两个互动节点。"
            : "基于当前报告，优先优化标题、发布时间和弹幕互动节点，这三项成本低且可用控制变量法验证。";
      return send(res, 200, { answer, prompt_tokens_guard: session.chat_context_summary.length + q.length });
    }
    send(res, 404, { message: "not found" });
  } catch (error) {
    send(res, 200, { message: `demo fallback: ${String(error).slice(0, 120)}` });
  }
});

server.listen(8000, "127.0.0.1", () => {
  console.log("Demo API server running at http://127.0.0.1:8000");
});
