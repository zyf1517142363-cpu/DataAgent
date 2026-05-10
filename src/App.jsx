import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bot, CheckCircle2, Download, FileText, FolderOpen, KeyRound, Link2, Loader2, PlayCircle, Plus, Send, Sparkles, TrendingUp, UploadCloud, Video } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function createSessionId() {
  const existing = localStorage.getItem("media_growth_session_id");
  if (existing) return existing;
  const next = `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("media_growth_session_id", next);
  return next;
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

const DEFAULT_VIDEO_URL = "https://www.bilibili.com/video/game-content-demo";
const DEFAULT_UPLOAD_STATE = "等待CSV";
const DEFAULT_REPORT = "报告将在点击“开始内容分析”后展示。";
const DEFAULT_WELCOME = "你好，我是你的 B 站游戏区 AI 分析助手。你可以上传 CSV 数据、输入视频链接，然后询问选题、标题、封面、留存、弹幕互动和发布时间策略。";

function blankSnapshot() {
  return {
    videoUrl: DEFAULT_VIDEO_URL,
    uploadState: DEFAULT_UPLOAD_STATE,
    csvStats: null,
    videoMeta: null,
    report: DEFAULT_REPORT,
    analysisData: {},
    messages: [{ role: "assistant", content: DEFAULT_WELCOME }],
  };
}

function newSessionId() {
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadLlmConfig() {
  const defaults = {
    mode: "local",
    localBaseUrl: "http://127.0.0.1:11434/v1",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "qwen2.5:7b",
    apiKey: "",
    temperature: 0.7,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("media_growth_llm_config") || "{}");
    return { ...defaults, ...saved, apiKey: "" };
  } catch {
    return defaults;
  }
}

function App() {
  const [sessionId, setSessionId] = useState(createSessionId);
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO_URL);
  const [uploadState, setUploadState] = useState(DEFAULT_UPLOAD_STATE);
  const [csvStats, setCsvStats] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [report, setReport] = useState(DEFAULT_REPORT);
  const [analysisData, setAnalysisData] = useState({});
  const [projects, setProjects] = useState(() => [
    { id: "p_default_1", name: "B站游戏区视频分析", time: "更新于 2026-05-01 14:30", active: true, sessionId: null, snapshot: null },
    { id: "p_default_2", name: "手游攻略内容复盘", time: "更新于 2026-05-01 09:15", active: false, sessionId: null, snapshot: null },
    { id: "p_default_3", name: "直播切片标题优化", time: "更新于 2026-04-30 16:45", active: false, sessionId: null, snapshot: null },
  ]);
  const [reportTab, setReportTab] = useState("report");
  const [loading, setLoading] = useState({ upload: false, video: false, analyze: false, chat: false, llm: false });
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [llmStatus, setLlmStatus] = useState({ connected: false, message: "大模型未连接" });
  const [messages, setMessages] = useState([{ role: "assistant", content: DEFAULT_WELCOME }]);
  const [question, setQuestion] = useState("");
  const messageEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("media_growth_session_id", sessionId);
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem("media_growth_llm_config", JSON.stringify({ ...llmConfig, apiKey: "" }));
  }, [llmConfig]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading.chat]);

  const causalFactors = useMemo(() => {
    const strategy = analysisData?.strategy?.causal_factors;
    const analysis = analysisData?.analysis?.causal_factors;
    return safeList(strategy?.length ? strategy : analysis).slice(0, 6);
  }, [analysisData]);

  const semanticTags = useMemo(() => safeList(analysisData?.knowledge?.semantic_tags), [analysisData]);

  async function apiJson(path, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 22000);
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function updateLlmConfig(key, value) {
    setLlmConfig((config) => ({ ...config, [key]: value }));
    setLlmStatus({ connected: false, message: "配置已更新，请重新测试连接。" });
  }

  function activeLlmBase() {
    return trimSlash(llmConfig.mode === "local" ? llmConfig.localBaseUrl : llmConfig.apiBaseUrl);
  }

  function buildSystemPrompt() {
    const lines = ["你是中文 B 站游戏区内容分析助手。请基于下方“当前视频”“CSV 数据概况”“分析报告”这三类已知信息回答用户。如果用户问到这些已经载入的内容，请直接引用，不要回答“尚未载入”。"];
    if (videoMeta) {
      lines.push("【当前视频】");
      lines.push(`- 标题：${videoMeta.title || "(未提供)"}`);
      lines.push(`- 场景：${videoMeta.scenario_type || "GAME"}`);
      if (Array.isArray(videoMeta.tags) && videoMeta.tags.length) lines.push(`- 标签：${videoMeta.tags.join("、")}`);
      if (videoMeta.url) lines.push(`- 链接：${videoMeta.url}`);
      if (videoMeta.mock_subtitle) lines.push(`- 字幕摘要：${String(videoMeta.mock_subtitle).slice(0, 400)}`);
    } else {
      lines.push("【当前视频】尚未载入。");
    }
    if (csvStats && csvStats.video_count > 0) {
      lines.push("【CSV 数据概况】");
      lines.push(`- 文件：${csvStats.file_name}`);
      lines.push(`- 视频数：${csvStats.video_count}`);
      lines.push(`- 平均播放：${Number(csvStats.avg_views || 0).toLocaleString()}`);
      if (csvStats.like_rate) lines.push(`- 点赞率：${(Number(csvStats.like_rate) * 100).toFixed(2)}%`);
      if (csvStats.comment_rate) lines.push(`- 评论率：${(Number(csvStats.comment_rate) * 100).toFixed(2)}%`);
    } else {
      lines.push("【CSV 数据概况】尚未上传或解析失败。");
    }
    if (report && !report.startsWith("报告将在") && !report.startsWith("Agent 并发")) {
      lines.push("【分析报告（节选）】");
      lines.push(String(report).slice(0, 1800));
    }
    return lines.join("\n");
  }

  async function callConfiguredLlm(userText, history = messages) {
    const baseUrl = activeLlmBase();
    if (!baseUrl) throw new Error("请先填写大模型接口地址");
    if (llmConfig.mode === "api" && !llmConfig.apiKey.trim()) throw new Error("请先填写 API Key");

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const headers = { "Content-Type": "application/json" };
      if (llmConfig.apiKey.trim()) headers.Authorization = `Bearer ${llmConfig.apiKey.trim()}`;
      const recentMessages = history.slice(-8).map((msg) => ({ role: msg.role === "user" ? "user" : "assistant", content: msg.content }));
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: llmConfig.model.trim() || "qwen2.5:7b",
          temperature: Number(llmConfig.temperature) || 0.7,
          stream: false,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...recentMessages,
            { role: "user", content: userText },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
      return data?.choices?.[0]?.message?.content || data?.message?.content || "大模型已响应，但返回内容为空。";
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function testLlmConnection() {
    setLoading((s) => ({ ...s, llm: true }));
    setLlmStatus({ connected: false, message: "正在连接大模型..." });
    try {
      const answer = await callConfiguredLlm("请只回复：连接成功", []);
      setLlmStatus({ connected: true, message: answer?.slice(0, 40) || "连接成功" });
    } catch (err) {
      setLlmStatus({ connected: false, message: err.message || "连接失败，请检查接口、模型名或 Key" });
    } finally {
      setLoading((s) => ({ ...s, llm: false }));
    }
  }

  async function uploadCsv(file) {
    if (!file) return;
    setLoading((s) => ({ ...s, upload: true }));
    setUploadState("上传中...");
    try {
      const body = new FormData();
      body.append("session_id", sessionId);
      body.append("file", file);
      const data = await apiJson("/upload", { method: "POST", body });
      if (data) {
        setCsvStats({
          file_name: file.name,
          video_count: data.video_count ?? 0,
          avg_views: data.avg_views ?? 0,
          like_rate: data.like_rate ?? 0,
          comment_rate: data.comment_rate ?? 0,
          status: data.status || "success",
        });
        setUploadState(`成功：${data.video_count} 条，平均播放 ${Number(data.avg_views || 0).toLocaleString()}`);
      }
    } catch (err) {
      setCsvStats({ file_name: file.name, video_count: 0, avg_views: 0, status: "fallback", error: err.message || "CSV解析失败" });
      setUploadState(`已降级：${err.message || "CSV解析失败"}`);
    } finally {
      setLoading((s) => ({ ...s, upload: false }));
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function loadSampleCsv() {
    const sample = ["title,views,likes,comments,duration", "黑神话隐藏Boss打法,188000,15100,2680,620", "原神新版本抽卡建议,126000,8900,2100,540", "王者荣耀赛季上分套路,154000,12000,3200,480", "独立游戏试玩避坑,72000,3600,640,430"].join("\n");
    await uploadCsv(new File([sample], "sample_bilibili_game_growth.csv", { type: "text/csv" }));
  }

  async function submitVideo() {
    setLoading((s) => ({ ...s, video: true }));
    try {
      const data = await apiJson("/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, url: videoUrl, scenario: "A" }) });
      if (data) setVideoMeta(data);
    } catch {
      setVideoMeta({ title: "B站游戏区视频Mock已启用", tags: ["游戏区", "攻略", "留存", "弹幕"], scenario_type: "GAME", mock_subtitle: "前端兜底演示文案。" });
    } finally {
      setLoading((s) => ({ ...s, video: false }));
    }
  }

  async function analyze() {
    setLoading((s) => ({ ...s, analyze: true }));
    setReport("Agent 并发调度中：DataAgent 与 VideoAnalysisAgent 正在并行运行...");
    try {
      if (!videoMeta) await submitVideo();
      const data = await apiJson("/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (data) {
        setReport(data.report || "报告生成完成，但内容为空。");
        setAnalysisData(data.data || {});
        setMessages((items) => [...items, { role: "assistant", content: "游戏区内容分析报告已生成。你可以继续追问标题、封面、开头留存、弹幕互动或发布时间。" }]);
      }
    } catch (err) {
      setReport(`系统触发展示兜底：${err.message || "分析失败"}。请确认后端已启动。`);
    } finally {
      setLoading((s) => ({ ...s, analyze: false }));
    }
  }

  async function sendQuestion(event) {
    event?.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    setMessages((items) => [...items, { role: "user", content: text }]);
    setLoading((s) => ({ ...s, chat: true }));
    try {
      const answer = llmStatus.connected
        ? await callConfiguredLlm(text, messages)
        : await apiJson("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, question: text }) }).then((data) => data?.answer || "已收到问题。请先生成报告以获得更完整的上下文。");
      setMessages((items) => [...items, { role: "assistant", content: answer }]);
    } catch (err) {
      setMessages((items) => [...items, { role: "assistant", content: `大模型暂不可用：${err.message || "请求失败"}。请检查接口地址、模型名和 API Key。` }]);
    } finally {
      setLoading((s) => ({ ...s, chat: false }));
    }
  }

  function downloadReport() {
    const safeTitle = (videoMeta?.title || "media_growth_report").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${safeTitle}_${stamp}.md`;
    const content = (report && report.trim()) ? report : "暂无报告内容，请先点击“开始分析”。";
    try {
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      window.alert(`报告保存失败：${err?.message || "请检查浏览器下载权限"}`);
    }
  }

  function resetSession() {
    const next = newSessionId();
    setSessionId(next);
    setVideoMeta(null);
    setCsvStats(null);
    setAnalysisData({});
    setReport("已创建新会话，请重新上传数据或输入视频链接。");
    setUploadState(DEFAULT_UPLOAD_STATE);
    setMessages([{ role: "assistant", content: "新会话已创建。请上传游戏区数据或输入 B 站视频链接后开始分析。" }]);
    setProjects((items) => items.map((item) => item.active ? { ...item, sessionId: next, snapshot: null, time: formatProjectTime(new Date()) } : item));
  }

  function formatProjectTime(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `更新于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function captureSnapshot() {
    return { videoUrl, uploadState, csvStats, videoMeta, report, analysisData, messages };
  }

  function applySnapshot(snap) {
    setVideoUrl(snap.videoUrl ?? DEFAULT_VIDEO_URL);
    setUploadState(snap.uploadState ?? DEFAULT_UPLOAD_STATE);
    setCsvStats(snap.csvStats ?? null);
    setVideoMeta(snap.videoMeta ?? null);
    setReport(snap.report ?? DEFAULT_REPORT);
    setAnalysisData(snap.analysisData ?? {});
    setMessages(Array.isArray(snap.messages) && snap.messages.length ? snap.messages : [{ role: "assistant", content: DEFAULT_WELCOME }]);
  }

  function addProject() {
    const input = (typeof window !== "undefined" ? window.prompt("输入新项目名称：", `游戏区新项目 ${new Date().toLocaleDateString()}`) : null);
    if (input === null) return;
    const name = input.trim() || `游戏区新项目 ${new Date().toLocaleTimeString()}`;
    const id = `p_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const sid = newSessionId();
    const snap = blankSnapshot();
    const currentSnapshot = captureSnapshot();
    setProjects((items) => {
      const updated = items.map((item) => item.active ? { ...item, active: false, sessionId: item.sessionId || sessionId, snapshot: currentSnapshot, time: formatProjectTime(new Date()) } : item);
      return [{ id, name, time: formatProjectTime(new Date()), active: true, sessionId: sid, snapshot: snap }, ...updated];
    });
    setSessionId(sid);
    applySnapshot(snap);
  }

  function selectProject(id) {
    const target = projects.find((item) => item.id === id);
    if (!target || target.active) return;
    const targetSnapshot = target.snapshot || blankSnapshot();
    const targetSessionId = target.sessionId || newSessionId();
    const currentSnapshot = captureSnapshot();
    setProjects((items) => items.map((item) => {
      if (item.active) return { ...item, active: false, sessionId: item.sessionId || sessionId, snapshot: currentSnapshot, time: formatProjectTime(new Date()) };
      if (item.id === id) return { ...item, active: true, sessionId: targetSessionId, snapshot: targetSnapshot };
      return item;
    }));
    setSessionId(targetSessionId);
    applySnapshot(targetSnapshot);
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] p-6 font-sans text-slate-600">
      <div className="mx-auto flex h-[calc(100vh-48px)] max-w-[1480px] gap-5">
        <LeftSidebar uploadState={uploadState} videoMeta={videoMeta} videoUrl={videoUrl} loading={loading} fileInputRef={fileInputRef} projects={projects} onVideoUrlChange={setVideoUrl} onUploadCsv={uploadCsv} onTriggerFilePicker={triggerFilePicker} onLoadSampleCsv={loadSampleCsv} onSubmitVideo={submitVideo} onAnalyze={analyze} onResetSession={resetSession} onAddProject={addProject} onSelectProject={selectProject} />
        <ChatCenter llmConfig={llmConfig} llmStatus={llmStatus} loading={loading} messages={messages} question={question} messageEndRef={messageEndRef} onQuestionChange={setQuestion} onSendQuestion={sendQuestion} onConfigChange={updateLlmConfig} onTestLlm={testLlmConnection} />
        <ReportPanel tab={reportTab} data={analysisData} report={report} causalFactors={causalFactors} semanticTags={semanticTags} onTabChange={setReportTab} onDownloadReport={downloadReport} />
      </div>
    </main>
  );
}

function LeftSidebar({ uploadState, videoMeta, videoUrl, loading, fileInputRef, projects, onVideoUrlChange, onUploadCsv, onTriggerFilePicker, onLoadSampleCsv, onSubmitVideo, onAnalyze, onResetSession, onAddProject, onSelectProject }) {
  return (
    <aside style={{ width: "18rem", flex: "0 0 18rem" }} className="flex h-full min-w-0 max-w-[18rem] shrink-0 grow-0 basis-72 flex-col gap-4 overflow-hidden rounded-2xl bg-white p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-center justify-between"><Brand /><button type="button" onClick={onAddProject} title="新建项目" className="rounded-xl bg-indigo-600 p-2 text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-indigo-500"><Plus size={16} /></button></div>
      <section><SectionHeader title="项目管理" /><div className="mt-3 space-y-2">{projects.map((project) => <button key={project.id} type="button" onClick={() => onSelectProject?.(project.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-300 ${project.active ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${project.active ? "bg-indigo-600 text-white" : "bg-amber-50 text-amber-500"}`}><FolderOpen size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{project.name}</span><span className="mt-0.5 block truncate text-xs text-slate-400">{project.time}</span></span></button>)}</div></section>
      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><SectionHeader title="数据输入" /><button type="button" onClick={onTriggerFilePicker} disabled={loading.upload} className="mt-3 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/60 px-4 py-6 text-center transition-colors duration-300 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-70">{loading.upload ? <Loader2 className="animate-spin text-indigo-600" /> : <UploadCloud className="text-indigo-600" />}<span className="mt-3 text-sm font-semibold text-slate-700">上传游戏区 CSV 数据</span><span className="mt-1 text-xs leading-5 text-slate-400">播放、点赞、评论、时长等指标</span></button><input ref={fileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => { const f = event.target.files?.[0]; if (f) onUploadCsv(f); else event.target.value = ""; }} /><button onClick={onLoadSampleCsv} className="mt-3 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors duration-300 hover:bg-slate-100">导入示例 CSV</button><p className="mt-2 break-words text-xs leading-5 text-indigo-600">{uploadState}</p></section>
      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><SectionHeader title="视频链接" /><div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 transition-all duration-300 focus-within:border-indigo-200 focus-within:bg-white"><Link2 size={15} className="text-slate-400" /><input value={videoUrl} onChange={(event) => onVideoUrlChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400" placeholder="https://www.bilibili.com/video/..." /></div><button onClick={onSubmitVideo} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-slate-800">{loading.video ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}载入视频</button></section>
      <div className="mt-auto space-y-3"><CurrentVideoCard videoMeta={videoMeta} /><button onClick={onAnalyze} disabled={loading.analyze} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgb(79,70,229,0.22)] transition-[transform,box-shadow,opacity] duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_34px_rgb(79,70,229,0.28)] disabled:cursor-not-allowed disabled:opacity-70">{loading.analyze ? <Loader2 size={18} className="animate-spin" /> : <BarChart3 size={18} />}开始分析</button><button onClick={onResetSession} className="w-full rounded-2xl border border-slate-100 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-all duration-300 hover:bg-slate-50">新建会话</button></div>
    </aside>
  );
}

function ChatCenter({ llmConfig, llmStatus, loading, messages, question, messageEndRef, onQuestionChange, onSendQuestion, onConfigChange, onTestLlm }) {
  return <section className="flex min-w-0 flex-1 flex-col rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]"><div className="border-b border-slate-100 p-5"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Bot size={22} /></span><div><h2 className="text-base font-semibold text-slate-800">AI 分析助手</h2><p className="mt-1 flex items-center gap-2 text-xs text-slate-400"><span className={`h-2 w-2 rounded-full ${llmStatus.connected ? "bg-emerald-500" : "bg-slate-300"}`} />{llmStatus.connected ? `已接入：${llmConfig.model}` : "未接入大模型时使用后端兜底问答"}</p></div></div><LlmModeSwitch config={llmConfig} onChange={onConfigChange} /></div><LlmInlineSettings config={llmConfig} status={llmStatus} loading={loading.llm} onChange={onConfigChange} onTest={onTestLlm} /></div><div className="flex-1 overflow-y-auto px-6 py-5"><div className="mx-auto flex max-w-3xl flex-col gap-4">{messages.map((message, index) => <ChatBubble key={`${message.role}-${index}`} message={message} />)}{loading.chat && <div className="flex items-center gap-2 text-sm text-indigo-600"><Loader2 size={16} className="animate-spin" />正在思考...</div>}<div ref={messageEndRef} /></div></div><div className="p-5"><form onSubmit={onSendQuestion} className="mx-auto max-w-3xl rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.06)]"><div className="flex items-center gap-2"><input value={question} onChange={(event) => onQuestionChange(event.target.value)} className="min-w-0 flex-1 rounded-xl px-4 py-3 text-sm text-slate-600 outline-none placeholder:text-slate-400" placeholder="询问开头留存、标题、封面、弹幕互动..." /><button type="submit" disabled={loading.chat} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(79,70,229,0.24)] disabled:cursor-not-allowed disabled:opacity-70">{loading.chat ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}</button></div></form><p className="mt-3 text-center text-xs text-slate-400">AI 生成内容仅供参考，请结合真实视频数据判断</p></div></section>;
}

function ReportPanel({ tab, data, report, causalFactors, semanticTags, onTabChange, onDownloadReport }) {
  return <aside className="flex w-[400px] shrink-0 flex-col rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"><div className="flex items-center justify-between"><ReportTabs active={tab} onChange={onTabChange} /><button type="button" onClick={onDownloadReport} title="下载报告(Markdown)" className="rounded-xl border border-slate-100 p-2 text-slate-400 transition-all duration-300 hover:bg-slate-50 hover:text-indigo-600"><Download size={17} /></button></div><div className="mt-5 flex-1 overflow-y-auto pr-1">{tab === "report" ? <div className="space-y-4"><MetricGrid data={data} /><ChartSlot title="播放趋势概览" /><ChartSlot title="互动影响因子" compact /><CausalFactors factors={causalFactors} /><SemanticTags tags={semanticTags} /></div> : <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><FileText size={17} className="text-indigo-600" /><h3 className="text-sm font-semibold text-slate-800">文字总结</h3></div><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-600">{report}</pre></section>}</div></aside>;
}

function Brand() { return <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm"><Sparkles size={20} /></span><span><span className="block text-sm font-semibold text-slate-800">AI自媒体分析助手</span><span className="mt-0.5 block text-xs text-slate-400">游戏区 Demo</span></span></div>; }
function SectionHeader({ title }) { return <h3 className="text-sm font-semibold tracking-wide text-slate-800">{title}</h3>; }
function CurrentVideoCard({ videoMeta }) { const tags = safeList(videoMeta?.tags); return <section className="min-w-0 overflow-hidden rounded-2xl bg-slate-900 p-4 text-white shadow-[0_8px_30px_rgb(15,23,42,0.16)]"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-indigo-200"><Video size={14} />当前视频</div><p className="line-clamp-2 break-words text-sm leading-6 text-white">{videoMeta?.title || "尚未载入游戏视频"}</p><div className="mt-3 flex min-w-0 flex-wrap gap-1.5">{tags.length === 0 && <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-300">等待载入</span>}{tags.map((tag) => <span key={tag} className="max-w-full truncate rounded-full bg-white/10 px-2 py-1 text-xs text-indigo-100">{tag}</span>)}</div></section>; }
function LlmModeSwitch({ config, onChange }) { return <div className="rounded-2xl bg-slate-100 p-1">{[["local", "本地模型"], ["api", "API接口"]].map(([mode, label]) => <button key={mode} type="button" onClick={() => onChange("mode", mode)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${config.mode === mode ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>)}</div>; }
function LlmInlineSettings({ config, status, loading, onChange, onTest }) { const isLocal = config.mode === "local"; return <div className="mt-5 grid grid-cols-[1fr_160px_1fr_150px] gap-3"><IconInput icon={<Link2 size={15} />} value={isLocal ? config.localBaseUrl : config.apiBaseUrl} onChange={(value) => onChange(isLocal ? "localBaseUrl" : "apiBaseUrl", value)} placeholder={isLocal ? "http://127.0.0.1:11434/v1" : "https://api.openai.com/v1"} /><IconInput icon={<Bot size={15} />} value={config.model} onChange={(value) => onChange("model", value)} placeholder="qwen2.5:7b" /><IconInput type="password" icon={<KeyRound size={15} />} value={config.apiKey} onChange={(value) => onChange("apiKey", value)} placeholder={isLocal ? "本地可留空" : "sk-..."} /><button type="button" onClick={onTest} disabled={loading} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70" title={status.message}>{loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}接入</button></div>; }
function IconInput({ icon, value, onChange, placeholder, type = "text" }) { return <label className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-slate-400 transition-all duration-300 focus-within:border-indigo-200 focus-within:bg-white">{icon}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400" placeholder={placeholder} /></label>; }
function ChatBubble({ message }) { const isUser = message.role === "user"; return <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 transition-all duration-300 ${isUser ? "bg-indigo-50 text-indigo-700" : "border border-slate-100 bg-white text-slate-600 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"}`}>{message.content}</div></div>; }
function ReportTabs({ active, onChange }) { return <div className="flex rounded-2xl bg-slate-100 p-1">{[["report", "分析报告"], ["summary", "文字总结"]].map(([key, label]) => <button key={key} onClick={() => onChange(key)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${active === key ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>)}</div>; }
function MetricGrid({ data }) { const metrics = [["播放量", data?.data?.metrics?.avg_views ?? "128K", "+12.4%"], ["互动热度", data?.video?.content_score ?? "82", "+8.6%"], ["完播潜力", data?.video?.virality_score ?? "76", "+5.2%"], ["弹幕转化", data?.knowledge?.semantic_tags?.length ?? "32.6%", "+2.1%"]]; return <section className="grid grid-cols-2 gap-3">{metrics.map(([label, value, trend]) => <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)]"><p className="text-xs font-medium text-slate-400">{label}</p><div className="mt-2 flex items-end justify-between gap-2"><span className="truncate text-xl font-semibold text-slate-800">{typeof value === "number" ? value.toLocaleString() : value}</span><span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600"><TrendingUp size={12} />{trend}</span></div></div>)}</section>; }
function ChartSlot({ title, compact = false }) { return <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><h3 className="text-sm font-semibold text-slate-800">{title}</h3><div className={`mt-4 overflow-hidden rounded-2xl bg-slate-50 ${compact ? "h-28" : "h-40"}`}><div className="flex h-full items-end gap-2 px-4 pb-4">{[34, 58, 44, 72, 52, 88, 64, 92, 78].map((height, index) => <span key={`${height}-${index}`} className="flex-1 rounded-t-xl bg-gradient-to-t from-indigo-500/70 to-violet-300/70 transition-all duration-300 hover:from-indigo-600" style={{ height: `${height}%` }} />)}</div></div></section>; }
function CausalFactors({ factors }) { return <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><h3 className="mb-4 text-sm font-semibold text-slate-800">播放影响因素</h3><div className="space-y-3">{factors.length === 0 && <p className="text-sm text-slate-400">等待分析结果...</p>}{factors.map((factor, index) => { const width = Math.max(8, Math.min(100, Number(factor.impact_weight || 0) * 100)); return <div key={`${factor.factor}-${index}`}><div className="mb-1 flex justify-between gap-3 text-xs text-slate-500"><span className="truncate">{factor.factor}</span><span>{Number(factor.confidence || 0).toFixed(2)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${width}%` }} /></div></div>; })}</div></section>; }
function SemanticTags({ tags }) { return <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><h3 className="mb-3 text-sm font-semibold text-slate-800">弹幕 / 语义分析</h3><div className="flex flex-wrap gap-2">{tags.length === 0 && <span className="text-sm text-slate-400">等待 KnowledgeAgent 输出...</span>}{tags.map((tag) => <span key={tag.term} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">{tag.term} - {tag.sentiment}</span>)}</div></section>; }

export default App;
