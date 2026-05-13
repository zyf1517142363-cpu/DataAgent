import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  FileText,
  Filter,
  FolderOpen,
  Gem,
  Globe,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PlayCircle,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  TrendingUp,
  UploadCloud,
  User,
  Video,
  X,
} from "lucide-react";

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

const DEFAULT_VIDEO_URL = "";
const DEFAULT_UPLOAD_STATE = "等待CSV";
const DEFAULT_REPORT = "报告将在点击“开始分析”后展示。";
const DEFAULT_WELCOME = "您好！我是您的增长策略助手\n我可以帮您分析数据、制定增长策略、生成分析报告。您可以从左侧添加数据源，或者直接在下方输入您的问题。";

function blankSnapshot() {
  return {
    videoUrl: DEFAULT_VIDEO_URL,
    uploadState: DEFAULT_UPLOAD_STATE,
    csvStats: null,
    videoMeta: null,
    videoError: "",
    report: DEFAULT_REPORT,
    analysisData: {},
    messages: [{ role: "assistant", content: DEFAULT_WELCOME }],
  };
}

function newSessionId() {
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function newWorkspaceId() {
  return `workspace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatDate(value) {
  try {
    const d = new Date(value || Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
  } catch {
    return "—";
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "—";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function createSession(workspaceId, title = "新会话", snapshot = blankSnapshot()) {
  const now = new Date().toISOString();
  const id = newSessionId();
  return {
    id,
    workspaceId,
    title,
    createdAt: now,
    updatedAt: now,
    summary: "新会话",
    snapshot,
  };
}

function createWorkspace(name = "新项目", folderPath = "Browser Sandbox", description = "") {
  const now = new Date().toISOString();
  const id = newWorkspaceId();
  const session = createSession(id, "默认会话");
  return {
    id,
    name,
    folderPath,
    description: description || "尚未填写项目描述",
    createdAt: now,
    updatedAt: now,
    memoryScopeId: `memory_${id}`,
    indexedFiles: [],
    activeSessionId: session.id,
    sessions: [session],
  };
}

function loadWorkspaceState() {
  try {
    const saved = JSON.parse(localStorage.getItem("media_growth_workspace_state") || "{}");
    if (Array.isArray(saved.workspaces) && saved.workspaces.length > 0) return saved;
  } catch {
    // ignore corrupted local state
  }
  const seedSpecs = [
    { name: "B站游戏区内容增长", description: "B 站游戏 UP 主选题、留存、互动增长策略" },
    { name: "电商平台用户增长策略", description: "针对电商平台的用户增长路径分析与策略制定" },
    { name: "SaaS产品留存优化方案", description: "分析 SaaS 产品留存问题，提出优化策略" },
  ];
  const workspaces = seedSpecs.map((spec) => createWorkspace(spec.name, `Browser Sandbox / ${spec.name}`, spec.description));
  return { currentWorkspaceId: workspaces[0].id, workspaces };
}

function inferWorkspaceFromFiles(files) {
  const list = Array.from(files || []);
  const firstPath = list[0]?.webkitRelativePath || list[0]?.name || "Imported Workspace";
  const root = firstPath.split("/")[0] || "Imported Workspace";
  return {
    name: root,
    folderPath: `Browser Sandbox / ${root}`,
    indexedFiles: list.slice(0, 500).map((file) => ({
      path: file.webkitRelativePath || file.name,
      size: file.size,
      updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
    })),
  };
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

const CARD_PALETTE = [
  { Icon: BarChart3, bg: "bg-emerald-50", color: "text-emerald-500" },
  { Icon: User, bg: "bg-violet-50", color: "text-violet-500" },
  { Icon: Megaphone, bg: "bg-orange-50", color: "text-orange-500" },
  { Icon: FileText, bg: "bg-sky-50", color: "text-sky-500" },
  { Icon: Filter, bg: "bg-pink-50", color: "text-pink-500" },
  { Icon: Gem, bg: "bg-purple-50", color: "text-purple-500" },
];

function pickPalette(seed) {
  const s = String(seed || "");
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return CARD_PALETTE[n % CARD_PALETTE.length];
}

const QUICK_ACTIONS = [
  "分析视频选题趋势",
  "制定用户留存策略",
  "生成增长分析报告",
  "其他问题...",
];

const NAV_ITEMS = [
  { id: "projects", label: "项目管理", Icon: Briefcase },
  { id: "sources", label: "数据来源", Icon: Database },
  { id: "studio", label: "Studio", Icon: Layers },
  { id: "settings", label: "设置", Icon: Settings },
];

function App() {
  const initialWorkspaceState = useMemo(loadWorkspaceState, []);
  const initialWorkspace = initialWorkspaceState.workspaces.find((item) => item.id === initialWorkspaceState.currentWorkspaceId) || initialWorkspaceState.workspaces[0];
  const initialSession = initialWorkspace?.sessions?.find((item) => item.id === initialWorkspace.activeSessionId) || initialWorkspace?.sessions?.[0];
  const initialSnapshot = initialSession?.snapshot || blankSnapshot();

  const [sessionId, setSessionId] = useState(initialSession?.id || createSessionId);
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO_URL);
  const [uploadState, setUploadState] = useState(DEFAULT_UPLOAD_STATE);
  const [csvStats, setCsvStats] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [videoError, setVideoError] = useState("");
  const [report, setReport] = useState(DEFAULT_REPORT);
  const [analysisData, setAnalysisData] = useState({});
  const [workspaces, setWorkspaces] = useState(initialWorkspaceState.workspaces);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(initialWorkspaceState.currentWorkspaceId);
  const [loading, setLoading] = useState({ upload: false, video: false, analyze: false, chat: false, llm: false });
  const [llmConfig, setLlmConfig] = useState(loadLlmConfig);
  const [llmStatus, setLlmStatus] = useState({ connected: false, message: "大模型未连接" });
  const [messages, setMessages] = useState(initialSnapshot.messages || [{ role: "assistant", content: DEFAULT_WELCOME }]);
  const [question, setQuestion] = useState("");

  const [currentView, setCurrentView] = useState("home");
  const [navTab, setNavTab] = useState("projects");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [studioPane, setStudioPane] = useState(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [sourceKeyword, setSourceKeyword] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const messageEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const questionInputRef = useRef(null);

  function mergeRemoteWorkspaces(remoteItems) {
    if (!Array.isArray(remoteItems) || remoteItems.length === 0) return;
    setWorkspaces((existing) => {
      const sessionSnapshotMap = new Map();
      const descriptionMap = new Map();
      for (const ws of existing) {
        descriptionMap.set(ws.id, ws.description);
        for (const s of safeList(ws.sessions)) {
          sessionSnapshotMap.set(`${ws.id}:${s.id}`, s.snapshot || blankSnapshot());
        }
      }
      const merged = remoteItems.map((ws) => ({
        id: ws.id,
        name: ws.name || ws.id,
        folderPath: ws.folderPath || ws.folder_path || "Browser Sandbox",
        description: descriptionMap.get(ws.id) || ws.description || "尚未填写项目描述",
        createdAt: ws.createdAt || new Date().toISOString(),
        updatedAt: ws.updatedAt || new Date().toISOString(),
        memoryScopeId: ws.memoryScopeId || `memory_${ws.id}`,
        indexedFiles: ws.indexedFiles || [],
        activeSessionId: ws.activeSessionId || safeList(ws.sessions)[0]?.id,
        sessions: safeList(ws.sessions).map((s) => ({
          id: s.id,
          workspaceId: ws.id,
          title: s.title || "新会话",
          createdAt: s.createdAt || new Date().toISOString(),
          updatedAt: s.updatedAt || new Date().toISOString(),
          summary: s.summary || "",
          snapshot: sessionSnapshotMap.get(`${ws.id}:${s.id}`) || blankSnapshot(),
        })),
      }));
      return merged.length > 0 ? merged : existing;
    });
  }

  useEffect(() => {
    applySnapshot(initialSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem("media_growth_session_id", sessionId);
  }, [sessionId]);

  useEffect(() => {
    const snapshot = captureSnapshot();
    const hydrated = workspaces.map((workspace) => workspace.id === currentWorkspaceId ? {
      ...workspace,
      activeSessionId: sessionId,
      sessions: safeList(workspace.sessions).map((item) => item.id === sessionId ? { ...item, snapshot, updatedAt: new Date().toISOString() } : item),
    } : workspace);
    localStorage.setItem("media_growth_workspace_state", JSON.stringify({ currentWorkspaceId, workspaces: hydrated }));
  }, [currentWorkspaceId, sessionId, workspaces, videoUrl, uploadState, csvStats, videoMeta, videoError, report, analysisData, messages]);

  useEffect(() => {
    localStorage.setItem("media_growth_llm_config", JSON.stringify({ ...llmConfig, apiKey: "" }));
  }, [llmConfig]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading.chat]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiJson("/workspace/list", {}, 12000);
        if (!active) return;
        const remote = safeList(data?.workspaces);
        if (remote.length > 0) {
          mergeRemoteWorkspaces(remote);
          setCurrentWorkspaceId((prev) => {
            const exists = remote.some((w) => w.id === prev);
            return exists ? prev : remote[0].id;
          });
        }
      } catch {
        // Keep local state when backend workspace metadata is unavailable.
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setVideoError("");
  }, [videoUrl]);

  const causalFactors = useMemo(() => {
    const strategy = analysisData?.strategy?.causal_factors;
    const analysis = analysisData?.analysis?.causal_factors;
    return safeList(strategy?.length ? strategy : analysis).slice(0, 6);
  }, [analysisData]);

  const semanticTags = useMemo(() => safeList(analysisData?.knowledge?.semantic_tags), [analysisData]);
  const currentWorkspace = useMemo(
    () => workspaces.find((item) => item.id === currentWorkspaceId) || workspaces[0],
    [currentWorkspaceId, workspaces]
  );
  const activeWorkspaceId = currentWorkspace?.id || "default_workspace";
  const sessions = safeList(currentWorkspace?.sessions);
  const currentSession = sessions.find((item) => item.id === currentWorkspace?.activeSessionId) || sessions[0];

  const dataSources = useMemo(() => {
    const items = [];
    if (csvStats) {
      items.push({
        id: "csv",
        type: "csv",
        title: csvStats.file_name || "CSV 数据",
        meta: `${csvStats.video_count || 0} 行 · ${csvStats.status === "success" ? "解析成功" : "降级"}`,
        Icon: FileText,
        accent: "bg-emerald-50 text-emerald-500",
      });
    }
    if (videoMeta) {
      items.push({
        id: "video",
        type: "video",
        title: videoMeta.title || "B 站视频",
        meta: videoMeta.url || "BV 链接",
        Icon: Video,
        accent: "bg-rose-50 text-rose-500",
      });
    }
    for (const file of safeList(currentWorkspace?.indexedFiles).slice(0, 30)) {
      items.push({
        id: `file:${file.path}`,
        type: "file",
        title: file.path,
        meta: `${formatBytes(file.size)} · ${formatDate(file.updatedAt)}`,
        Icon: FolderOpen,
        accent: "bg-indigo-50 text-indigo-500",
      });
    }
    const keyword = sourceKeyword.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(keyword));
  }, [csvStats, videoMeta, currentWorkspace, sourceKeyword]);

  async function apiJson(path, options = {}, requestTimeoutMs = 22000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = data?.message || `HTTP ${res.status}`;
        const detail = data?.detail;
        if (typeof detail === "string") msg = detail;
        else if (Array.isArray(detail)) msg = detail.map((x) => (typeof x === "object" && x?.msg ? x.msg : String(x))).join("；");
        throw new Error(msg);
      }
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
    const lines = ["你是中文增长策略助手。请基于下方“当前视频”“CSV 数据概况”“分析报告”三类已知信息回答用户。如果用户问到这些已经载入的内容，请直接引用，不要回答“尚未载入”。"];
    if (videoMeta) {
      lines.push("【当前视频】");
      lines.push(`- 标题：${videoMeta.title || "(未提供)"}`);
      lines.push(`- 场景：${videoMeta.scenario_type || "GAME"}`);
      if (Array.isArray(videoMeta.tags) && videoMeta.tags.length) lines.push(`- 标签：${videoMeta.tags.join("、")}`);
      if (videoMeta.url) lines.push(`- 链接：${videoMeta.url}`);
      if (videoMeta.bilibili_stat) {
        const s = videoMeta.bilibili_stat;
        lines.push(`- B站统计：播放 ${s.view ?? "—"}，点赞 ${s.like ?? "—"}，评论 ${s.reply ?? "—"}，弹幕 ${s.danmaku ?? "—"}`);
      }
      if (videoMeta.mock_subtitle) lines.push(`- 字幕/简介（节选）：\n${String(videoMeta.mock_subtitle).slice(0, 4500)}`);
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
      body.append("workspace_id", activeWorkspaceId);
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
      setAddSourceOpen(false);
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
    if (!String(videoUrl || "").trim()) {
      setVideoError("请输入含 BV 号的 B 站视频页链接。");
      setVideoMeta(null);
      return null;
    }
    setLoading((s) => ({ ...s, video: true }));
    setVideoError("");
    try {
      const data = await apiJson("/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: activeWorkspaceId, session_id: sessionId, url: videoUrl }) }, 60000);
      if (data) {
        setVideoMeta(data);
        setAddSourceOpen(false);
        return data;
      }
      return null;
    } catch (err) {
      setVideoMeta(null);
      setVideoError(err?.message || "载入视频失败，请检查链接是否为有效 BV 页、网络与后端服务。");
      return null;
    } finally {
      setLoading((s) => ({ ...s, video: false }));
    }
  }

  async function analyze() {
    setLoading((s) => ({ ...s, analyze: true }));
    setReport("Agent 并发调度中：DataAgent 与 VideoAnalysisAgent 正在并行运行...");
    setStudioPane("report");
    try {
      let meta = videoMeta;
      if (!meta) meta = await submitVideo();
      if (!meta) {
        setReport("请先成功载入视频：请使用包含 BV 号的 B 站视频页链接，并查看左侧错误提示。");
        return;
      }
      const data = await apiJson("/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: activeWorkspaceId, session_id: sessionId }) }, 130000);
      if (data) {
        setReport(data.report || "报告生成完成，但内容为空。");
        setAnalysisData(data.data || {});
        const llmNote = data.report_llm ? " 报告正文由服务端大模型生成。" : "";
        setMessages((items) => [...items, { role: "assistant", content: `分析报告已生成。${llmNote}你可以继续追问选题、标题、封面、留存、弹幕互动或发布时间。` }]);
      }
    } catch (err) {
      setReport(`系统触发兜底：${err.message || "分析失败"}。请确认后端已启动。`);
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
        : await apiJson("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: activeWorkspaceId, session_id: sessionId, question: text }) }).then((data) => data?.answer || "已收到问题。请先生成报告以获得更完整的上下文。");
      setMessages((items) => [...items, { role: "assistant", content: answer }]);
    } catch (err) {
      setMessages((items) => [...items, { role: "assistant", content: `大模型暂不可用：${err.message || "请求失败"}。请检查接口地址、模型名和 API Key。` }]);
    } finally {
      setLoading((s) => ({ ...s, chat: false }));
    }
  }

  function downloadReport() {
    const safeTitle = (videoMeta?.title || currentWorkspace?.name || "growth_report").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
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

  function captureSnapshot() {
    return { videoUrl, uploadState, csvStats, videoMeta, videoError, report, analysisData, messages };
  }

  function applySnapshot(snap) {
    setVideoUrl(snap.videoUrl ?? DEFAULT_VIDEO_URL);
    setUploadState(snap.uploadState ?? DEFAULT_UPLOAD_STATE);
    setCsvStats(snap.csvStats ?? null);
    setVideoMeta(snap.videoMeta ?? null);
    setVideoError(snap.videoError ?? "");
    setReport(snap.report ?? DEFAULT_REPORT);
    setAnalysisData(snap.analysisData ?? {});
    setMessages(Array.isArray(snap.messages) && snap.messages.length ? snap.messages : [{ role: "assistant", content: DEFAULT_WELCOME }]);
  }

  function triggerFolderPicker() {
    folderInputRef.current?.click();
  }

  async function importFolder(files) {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    const currentSnapshot = captureSnapshot();
    const info = inferWorkspaceFromFiles(list);
    const workspace = createWorkspace(info.name, info.folderPath, `导入文件夹：${info.indexedFiles.length} 个文件`);
    workspace.indexedFiles = info.indexedFiles;
    const firstSession = workspace.sessions[0];
    firstSession.title = "默认会话";
    firstSession.summary = `${info.indexedFiles.length} 个文件已索引`;

    try {
      const imported = await apiJson("/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          name: workspace.name,
          folder_path: workspace.folderPath,
          indexed_files: workspace.indexedFiles,
        }),
      }, 30000);
      if (imported?.workspace) {
        mergeRemoteWorkspaces([imported.workspace, ...workspaces]);
      } else {
        setWorkspaces((items) => [
          workspace,
          ...items.map((item) => item.id === currentWorkspaceId ? {
            ...item,
            sessions: safeList(item.sessions).map((session) => session.id === sessionId ? { ...session, snapshot: currentSnapshot, updatedAt: new Date().toISOString() } : session),
          } : item),
        ]);
      }
    } catch {
      setWorkspaces((items) => [
        workspace,
        ...items.map((item) => item.id === currentWorkspaceId ? {
          ...item,
          sessions: safeList(item.sessions).map((session) => session.id === sessionId ? { ...session, snapshot: currentSnapshot, updatedAt: new Date().toISOString() } : session),
        } : item),
      ]);
    }
    setCurrentWorkspaceId(workspace.id);
    setSessionId(firstSession.id);
    applySnapshot(firstSession.snapshot);
    setCurrentView("project");
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function createNewProject() {
    const name = window.prompt("新建项目名称：", "新项目");
    if (name === null) return;
    const finalName = (name || "").trim() || `新项目${(Date.now() % 10000)}`;
    const desc = window.prompt("项目描述（可留空）：", "") || "尚未填写项目描述";
    const workspace = createWorkspace(finalName, `Browser Sandbox / ${finalName}`, desc);
    setWorkspaces((items) => [workspace, ...items]);
    setCurrentWorkspaceId(workspace.id);
    setSessionId(workspace.sessions[0].id);
    applySnapshot(workspace.sessions[0].snapshot);
    setCurrentView("project");
    try {
      await apiJson("/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          name: workspace.name,
          folder_path: workspace.folderPath,
          indexed_files: [],
        }),
      }, 12000);
    } catch {
      // backend offline 时仍保留本地项目
    }
  }

  async function deleteWorkspaceLocal(targetId) {
    if (!window.confirm("确认删除该项目？该项目下的会话也会一起被移除。")) return;
    setWorkspaces((items) => items.filter((w) => w.id !== targetId));
    if (currentWorkspaceId === targetId) {
      const fallback = workspaces.find((w) => w.id !== targetId);
      if (fallback) {
        setCurrentWorkspaceId(fallback.id);
        setSessionId(fallback.sessions[0]?.id || newSessionId());
        applySnapshot(fallback.sessions[0]?.snapshot || blankSnapshot());
      } else {
        const fresh = createWorkspace("新项目", "Browser Sandbox / 新项目");
        setWorkspaces([fresh]);
        setCurrentWorkspaceId(fresh.id);
        setSessionId(fresh.sessions[0].id);
        applySnapshot(fresh.sessions[0].snapshot);
      }
    }
  }

  function enterProject(id) {
    if (id !== currentWorkspaceId) {
      const target = workspaces.find((item) => item.id === id);
      if (!target) return;
      const currentSnapshot = captureSnapshot();
      const targetSession = safeList(target.sessions).find((item) => item.id === target.activeSessionId) || safeList(target.sessions)[0];
      setWorkspaces((items) => items.map((workspace) => workspace.id === currentWorkspaceId ? {
        ...workspace,
        sessions: safeList(workspace.sessions).map((session) => session.id === sessionId ? { ...session, snapshot: currentSnapshot, updatedAt: new Date().toISOString() } : session),
      } : workspace));
      setCurrentWorkspaceId(id);
      setSessionId(targetSession?.id || newSessionId());
      applySnapshot(targetSession?.snapshot || blankSnapshot());
    }
    setCurrentView("project");
  }

  function goHome() {
    setCurrentView("home");
    setProjectMenuOpen(false);
    setModelMenuOpen(false);
    setAddSourceOpen(false);
  }

  function handleQuickAction(text) {
    setQuestion(text);
    questionInputRef.current?.focus();
  }

  function removeDataSource(item) {
    if (item.type === "csv") {
      setCsvStats(null);
      setUploadState(DEFAULT_UPLOAD_STATE);
    } else if (item.type === "video") {
      setVideoMeta(null);
      setVideoUrl("");
    } else if (item.type === "file") {
      const path = item.id.slice("file:".length);
      setWorkspaces((items) => items.map((w) => w.id === currentWorkspaceId ? {
        ...w,
        indexedFiles: safeList(w.indexedFiles).filter((f) => f.path !== path),
      } : w));
    }
  }

  return (
    <main className="min-h-screen bg-[#F6F7FB] font-sans text-slate-700">
      <input ref={folderInputRef} className="sr-only" type="file" multiple webkitdirectory="" directory="" onChange={(event) => importFolder(event.target.files)} />
      <input ref={fileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => { const f = event.target.files?.[0]; if (f) uploadCsv(f); else event.target.value = ""; }} />
      {currentView === "home" ? (
        <HomePage
          workspaces={workspaces}
          navTab={navTab}
          onNavChange={setNavTab}
          onEnterProject={enterProject}
          onCreateProject={createNewProject}
          onImportFolder={triggerFolderPicker}
          onDeleteProject={deleteWorkspaceLocal}
        />
      ) : (
        <ProjectPage
          workspaces={workspaces}
          currentWorkspace={currentWorkspace}
          currentSession={currentSession}
          sessions={sessions}
          dataSources={dataSources}
          messages={messages}
          loading={loading}
          question={question}
          videoUrl={videoUrl}
          videoError={videoError}
          uploadState={uploadState}
          report={report}
          analysisData={analysisData}
          causalFactors={causalFactors}
          semanticTags={semanticTags}
          llmConfig={llmConfig}
          llmStatus={llmStatus}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          modelMenuOpen={modelMenuOpen}
          studioPane={studioPane}
          addSourceOpen={addSourceOpen}
          sourceKeyword={sourceKeyword}
          projectMenuOpen={projectMenuOpen}
          messageEndRef={messageEndRef}
          questionInputRef={questionInputRef}
          onToggleLeft={() => setLeftCollapsed((v) => !v)}
          onToggleRight={() => setRightCollapsed((v) => !v)}
          onToggleModelMenu={() => setModelMenuOpen((v) => !v)}
          onCloseModelMenu={() => setModelMenuOpen(false)}
          onToggleAddSource={() => setAddSourceOpen((v) => !v)}
          onCloseAddSource={() => setAddSourceOpen(false)}
          onToggleProjectMenu={() => setProjectMenuOpen((v) => !v)}
          onCloseProjectMenu={() => setProjectMenuOpen(false)}
          onSourceKeywordChange={setSourceKeyword}
          onStudioPaneChange={setStudioPane}
          onConfigChange={updateLlmConfig}
          onTestLlm={testLlmConnection}
          onUploadCsv={uploadCsv}
          onTriggerFilePicker={triggerFilePicker}
          onLoadSampleCsv={loadSampleCsv}
          onTriggerFolderPicker={triggerFolderPicker}
          onVideoUrlChange={setVideoUrl}
          onSubmitVideo={submitVideo}
          onAnalyze={analyze}
          onSendQuestion={sendQuestion}
          onQuestionChange={setQuestion}
          onQuickAction={handleQuickAction}
          onRemoveSource={removeDataSource}
          onGoHome={goHome}
          onEnterProject={enterProject}
          onCreateProject={createNewProject}
          onDownloadReport={downloadReport}
        />
      )}
    </main>
  );
}

function HomePage({ workspaces, navTab, onNavChange, onEnterProject, onCreateProject, onImportFolder, onDeleteProject }) {
  return (
    <div className="flex h-screen">
      <NavRail current={navTab} onChange={onNavChange} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-100 bg-white px-8 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm"><Sparkles size={18} /></span>
            <div>
              <h1 className="text-base font-semibold text-slate-800">增长策略 Agent</h1>
              <p className="text-xs text-slate-400">真实数据 · 多智能体 · 可解释报告</p>
            </div>
          </div>
          <button type="button" className="flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-indigo-600">
            查看全部 <ArrowRight size={14} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-8 thin-scrollbar">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">项目管理</h2>
            <button type="button" onClick={onImportFolder} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600">
              <FolderOpen size={14} /> 从文件夹导入
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <NewProjectCard onClick={onCreateProject} />
            {workspaces.map((workspace) => (
              <ProjectCard key={workspace.id} workspace={workspace} onOpen={() => onEnterProject(workspace.id)} onDelete={() => onDeleteProject(workspace.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavRail({ current, onChange }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-100 bg-white px-3 py-5">
      <div className="px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white"><Sparkles size={18} /></span>
          <span className="text-sm font-semibold text-slate-800">增长策略 Agent</span>
        </div>
      </div>
      <nav className="mt-6 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${current === id ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
          >
            <Icon size={16} />{label}
          </button>
        ))}
      </nav>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600"><User size={15} /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-700">用户</p>
          <p className="truncate text-[11px] text-slate-400">本地会话</p>
        </div>
      </div>
    </aside>
  );
}

function NewProjectCard({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-white text-slate-400 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 transition-colors group-hover:bg-indigo-100"><Plus size={22} /></span>
      <span className="text-sm font-semibold">新建项目</span>
    </button>
  );
}

function ProjectCard({ workspace, onOpen, onDelete }) {
  const palette = pickPalette(workspace.name);
  const { Icon, bg, color } = palette;
  const dataCount = (workspace.indexedFiles?.length || 0) + (workspace.sessions?.length || 0);
  return (
    <div className="group relative flex h-[180px] cursor-pointer flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(99,102,241,0.12)]" onClick={onOpen}>
      <div className="flex items-start justify-between">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${bg} ${color}`}><Icon size={20} /></span>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete?.(); }}
          className="rounded-lg p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
          title="删除项目"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <h3 className="mt-4 line-clamp-1 text-base font-semibold text-slate-800">{workspace.name}</h3>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{workspace.description || "尚未填写项目描述"}</p>
      <div className="mt-auto flex items-center justify-between text-[11px] text-slate-400">
        <span>{formatDate(workspace.updatedAt)}</span>
        <span>· {dataCount || 0} 个数据源</span>
      </div>
    </div>
  );
}

function ProjectPage(props) {
  const {
    workspaces, currentWorkspace, currentSession, sessions, dataSources, messages, loading,
    question, videoUrl, videoError, uploadState, report, analysisData, causalFactors, semanticTags,
    llmConfig, llmStatus, leftCollapsed, rightCollapsed, modelMenuOpen, studioPane, addSourceOpen,
    sourceKeyword, projectMenuOpen, messageEndRef, questionInputRef,
    onToggleLeft, onToggleRight, onToggleModelMenu, onCloseModelMenu, onToggleAddSource, onCloseAddSource,
    onToggleProjectMenu, onCloseProjectMenu, onSourceKeywordChange, onStudioPaneChange, onConfigChange,
    onTestLlm, onUploadCsv, onTriggerFilePicker, onLoadSampleCsv, onTriggerFolderPicker, onVideoUrlChange,
    onSubmitVideo, onAnalyze, onSendQuestion, onQuestionChange, onQuickAction, onRemoveSource,
    onGoHome, onEnterProject, onCreateProject, onDownloadReport,
  } = props;
  return (
    <div className="flex h-screen bg-[#F6F7FB]">
      {leftCollapsed ? (
        <LeftRailHandle onExpand={onToggleLeft} />
      ) : (
        <LeftDataSources
          dataSources={dataSources}
          addSourceOpen={addSourceOpen}
          sourceKeyword={sourceKeyword}
          loading={loading}
          videoUrl={videoUrl}
          videoError={videoError}
          uploadState={uploadState}
          onToggleCollapse={onToggleLeft}
          onToggleAddSource={onToggleAddSource}
          onCloseAddSource={onCloseAddSource}
          onSourceKeywordChange={onSourceKeywordChange}
          onTriggerFilePicker={onTriggerFilePicker}
          onLoadSampleCsv={onLoadSampleCsv}
          onTriggerFolderPicker={onTriggerFolderPicker}
          onVideoUrlChange={onVideoUrlChange}
          onSubmitVideo={onSubmitVideo}
          onRemoveSource={onRemoveSource}
          onGoHome={onGoHome}
        />
      )}
      <ChatCenter
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        currentSession={currentSession}
        sessions={sessions}
        messages={messages}
        loading={loading}
        question={question}
        llmConfig={llmConfig}
        llmStatus={llmStatus}
        modelMenuOpen={modelMenuOpen}
        projectMenuOpen={projectMenuOpen}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        messageEndRef={messageEndRef}
        questionInputRef={questionInputRef}
        onToggleModelMenu={onToggleModelMenu}
        onCloseModelMenu={onCloseModelMenu}
        onToggleProjectMenu={onToggleProjectMenu}
        onCloseProjectMenu={onCloseProjectMenu}
        onConfigChange={onConfigChange}
        onTestLlm={onTestLlm}
        onSendQuestion={onSendQuestion}
        onQuestionChange={onQuestionChange}
        onQuickAction={onQuickAction}
        onEnterProject={onEnterProject}
        onCreateProject={onCreateProject}
        onGoHome={onGoHome}
        onToggleLeft={onToggleLeft}
        onToggleRight={onToggleRight}
        onAnalyze={onAnalyze}
      />
      {rightCollapsed ? (
        <RightRailHandle onExpand={onToggleRight} />
      ) : (
        <RightStudio
          studioPane={studioPane}
          report={report}
          analysisData={analysisData}
          causalFactors={causalFactors}
          semanticTags={semanticTags}
          loading={loading}
          onStudioPaneChange={onStudioPaneChange}
          onToggleCollapse={onToggleRight}
          onAnalyze={onAnalyze}
          onDownloadReport={onDownloadReport}
        />
      )}
    </div>
  );
}

function LeftRailHandle({ onExpand }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center border-r border-slate-100 bg-white py-4">
      <button type="button" onClick={onExpand} className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-indigo-600" title="展开数据来源">
        <PanelLeft size={16} />
      </button>
      <Database size={16} className="mt-3 text-slate-300" />
    </div>
  );
}

function RightRailHandle({ onExpand }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center border-l border-slate-100 bg-white py-4">
      <button type="button" onClick={onExpand} className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-indigo-600" title="展开 Studio">
        <PanelRight size={16} />
      </button>
      <Layers size={16} className="mt-3 text-slate-300" />
    </div>
  );
}

function LeftDataSources(props) {
  const {
    dataSources, addSourceOpen, sourceKeyword, loading, videoUrl, videoError, uploadState,
    onToggleCollapse, onToggleAddSource, onCloseAddSource, onSourceKeywordChange,
    onTriggerFilePicker, onLoadSampleCsv, onTriggerFolderPicker,
    onVideoUrlChange, onSubmitVideo, onRemoveSource, onGoHome,
  } = props;
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-slate-100 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onGoHome} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-indigo-600" title="返回首页"><ArrowLeft size={15} /></button>
          <span className="text-sm font-semibold text-slate-800">数据来源</span>
        </div>
        <button type="button" onClick={onToggleCollapse} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50" title="收起"><ChevronsLeft size={16} /></button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleAddSource}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          <Plus size={15} /> 添加数据源
        </button>
        {addSourceOpen ? (
          <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <button type="button" onClick={onTriggerFilePicker} disabled={loading.upload} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-slate-600 shadow-sm transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-60">
              {loading.upload ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              上传 CSV 数据
            </button>
            <button type="button" onClick={onLoadSampleCsv} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-slate-600 shadow-sm transition-colors hover:bg-indigo-50 hover:text-indigo-600">
              <FileText size={14} /> 导入示例 CSV
            </button>
            <button type="button" onClick={onTriggerFolderPicker} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-slate-600 shadow-sm transition-colors hover:bg-indigo-50 hover:text-indigo-600">
              <FolderOpen size={14} /> 导入文件夹
            </button>
            <div className="rounded-xl bg-white p-2 shadow-sm">
              <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5">
                <Link2 size={13} className="text-slate-400" />
                <input
                  value={videoUrl}
                  onChange={(event) => onVideoUrlChange(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                  placeholder="粘贴 B 站视频链接"
                />
              </div>
              <button type="button" onClick={onSubmitVideo} disabled={loading.video} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60">
                {loading.video ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />} 载入视频
              </button>
              {videoError ? <p className="mt-2 break-words text-[11px] text-red-500">{videoError}</p> : null}
            </div>
            <button type="button" onClick={onCloseAddSource} className="flex w-full items-center justify-center gap-2 rounded-xl bg-transparent px-3 py-1 text-xs text-slate-400 hover:text-slate-600">
              <X size={12} /> 收起
            </button>
          </div>
        ) : null}
        <div className="text-[11px] font-medium text-slate-400">{uploadState}</div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-slate-400">
          <Search size={14} />
          <input
            value={sourceKeyword}
            onChange={(event) => onSourceKeywordChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-600 outline-none placeholder:text-slate-400"
            placeholder="在数据来源中搜索..."
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip Icon={Globe} label="Web" />
          <FilterChip Icon={Filter} label="Fast Research" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 thin-scrollbar">
        {dataSources.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
            还没有数据源。点击上方“添加数据源”导入 CSV、视频链接或文件夹。
          </div>
        ) : (
          <ul className="space-y-2">
            {dataSources.map((item) => (
              <li key={item.id} className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${item.accent}`}><item.Icon size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-700">{item.title}</p>
                  <p className="truncate text-[11px] text-slate-400">{item.meta}</p>
                </div>
                <button type="button" onClick={() => onRemoveSource(item)} className="rounded-lg p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="移除"><X size={13} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function FilterChip({ Icon, label }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
      <Icon size={11} /> {label} <ChevronDown size={10} />
    </span>
  );
}

function ChatCenter(props) {
  const {
    workspaces, currentWorkspace, currentSession, sessions, messages, loading, question,
    llmConfig, llmStatus, modelMenuOpen, projectMenuOpen, leftCollapsed, rightCollapsed,
    messageEndRef, questionInputRef,
    onToggleModelMenu, onCloseModelMenu, onToggleProjectMenu, onCloseProjectMenu,
    onConfigChange, onTestLlm, onSendQuestion, onQuestionChange, onQuickAction,
    onEnterProject, onCreateProject, onGoHome, onToggleLeft, onToggleRight, onAnalyze,
  } = props;
  const charCount = Math.min(question.length, 2000);
  const showWelcome = messages.length <= 1 && (messages[0]?.role !== "user");
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#F6F7FB]">
      <header className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          {leftCollapsed ? <button type="button" onClick={onToggleLeft} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50" title="展开数据来源"><PanelLeft size={15} /></button> : null}
          <span className="text-xs font-medium text-slate-400">对话</span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={onToggleProjectMenu}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            {currentWorkspace?.name || "未命名项目"} <ChevronDown size={14} />
          </button>
          {projectMenuOpen ? (
            <>
              <button type="button" aria-hidden onClick={onCloseProjectMenu} className="fixed inset-0 z-30 cursor-default bg-transparent" />
              <div className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[280px] -translate-x-1/2 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_12px_40px_rgba(15,23,42,0.12)]">
                <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">切换项目</p>
                <div className="max-h-60 overflow-y-auto thin-scrollbar">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => { onCloseProjectMenu(); onEnterProject(workspace.id); }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${workspace.id === currentWorkspace?.id ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <span className="truncate">{workspace.name}</span>
                      {workspace.id === currentWorkspace?.id ? <CheckCircle2 size={14} /> : null}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                  <button type="button" onClick={() => { onCloseProjectMenu(); onCreateProject(); }} className="flex items-center justify-center gap-1 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100"><Plus size={12} /> 新建项目</button>
                  <button type="button" onClick={() => { onCloseProjectMenu(); onGoHome(); }} className="flex items-center justify-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"><ArrowLeft size={12} /> 返回首页</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={onToggleModelMenu}
              className={`flex items-center gap-1.5 rounded-xl border border-slate-100 px-3 py-1.5 text-sm font-medium transition-colors ${llmStatus.connected ? "bg-emerald-50 text-emerald-600" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              <Bot size={14} /> 模型接入 <ChevronDown size={12} />
            </button>
            {modelMenuOpen ? (
              <>
                <button type="button" aria-hidden onClick={onCloseModelMenu} className="fixed inset-0 z-30 cursor-default bg-transparent" />
                <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[340px] rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_12px_40px_rgba(15,23,42,0.12)]">
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">选择模型接入方式</p>
                  <div className="space-y-2">
                    <ModelOption
                      active={llmConfig.mode === "api"}
                      Icon={Globe}
                      title="API 接入"
                      desc="通过 API 连接外部模型服务"
                      onClick={() => onConfigChange("mode", "api")}
                    />
                    <ModelOption
                      active={llmConfig.mode === "local"}
                      Icon={Bot}
                      title="本地模型"
                      desc="使用本地部署的模型"
                      onClick={() => onConfigChange("mode", "local")}
                    />
                  </div>
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <LabeledInput Icon={Link2} value={llmConfig.mode === "local" ? llmConfig.localBaseUrl : llmConfig.apiBaseUrl} onChange={(value) => onConfigChange(llmConfig.mode === "local" ? "localBaseUrl" : "apiBaseUrl", value)} placeholder={llmConfig.mode === "local" ? "http://127.0.0.1:11434/v1" : "https://api.openai.com/v1"} />
                    <LabeledInput Icon={Bot} value={llmConfig.model} onChange={(value) => onConfigChange("model", value)} placeholder="qwen2.5:7b" />
                    <LabeledInput Icon={KeyRound} type="password" value={llmConfig.apiKey} onChange={(value) => onConfigChange("apiKey", value)} placeholder={llmConfig.mode === "local" ? "本地可留空" : "sk-..."} />
                    <button type="button" onClick={onTestLlm} disabled={loading.llm} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60">
                      {loading.llm ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 测试接入
                    </button>
                    <p className={`text-[11px] ${llmStatus.connected ? "text-emerald-600" : "text-slate-400"}`}>{llmStatus.message}</p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          {rightCollapsed ? <button type="button" onClick={onToggleRight} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50" title="展开 Studio"><PanelRight size={15} /></button> : null}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6 thin-scrollbar">
        {showWelcome ? (
          <WelcomePanel onQuickAction={onQuickAction} onAnalyze={onAnalyze} loading={loading} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message, index) => (<ChatBubble key={`${message.role}-${index}`} message={message} />))}
            {loading.chat ? <div className="flex items-center gap-2 text-sm text-indigo-600"><Loader2 size={16} className="animate-spin" /> 正在思考...</div> : null}
            <div ref={messageEndRef} />
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 bg-white px-6 py-4">
        <form onSubmit={onSendQuestion} className="mx-auto flex max-w-3xl items-end gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
          <textarea
            ref={questionInputRef}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value.slice(0, 2000))}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSendQuestion(event); } }}
            rows={1}
            className="min-h-[36px] min-w-0 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="输入您的问题或需求..."
          />
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-[11px] text-slate-400">{charCount}/2000</span>
            <button type="submit" disabled={loading.chat || !question.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60">
              {loading.chat ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </form>
        <p className="mt-2 text-center text-[11px] text-slate-400">增长策略 Agent 可能会出错，请核实重要信息。</p>
      </div>
    </section>
  );
}

function WelcomePanel({ onQuickAction, onAnalyze, loading }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pt-12 text-center">
      <span className="text-3xl">👋</span>
      <h2 className="mt-3 text-xl font-semibold text-slate-800">您好！我是您的增长策略助手</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">
        我可以帮您分析数据、制定增长策略、生成分析报告。您可以从左侧添加数据源，<br />
        或者直接在下方输入您的问题。
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {QUICK_ACTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onQuickAction(text)}
            className="rounded-full border border-slate-100 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          >
            {text}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={loading.analyze}
        className="mt-8 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(99,102,241,0.22)] transition-all hover:-translate-y-0.5 disabled:opacity-60"
      >
        {loading.analyze ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />} 开始分析
      </button>
    </div>
  );
}

function ModelOption({ active, Icon, title, desc, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-indigo-200 bg-indigo-50" : "border-slate-100 bg-white hover:bg-slate-50"}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${active ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${active ? "text-indigo-700" : "text-slate-700"}`}>{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{desc}</p>
      </div>
      {active ? <CheckCircle2 size={14} className="text-indigo-500" /> : null}
    </button>
  );
}

function LabeledInput({ Icon, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-slate-400 transition-colors focus-within:border-indigo-200 focus-within:bg-white">
      <Icon size={13} />
      <input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
      />
    </label>
  );
}

function ChatBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 transition-all ${isUser ? "bg-indigo-50 text-indigo-700" : "border border-slate-100 bg-white text-slate-600 shadow-[0_4px_16px_rgba(15,23,42,0.04)]"}`}>
        {message.content}
      </div>
    </div>
  );
}

function RightStudio(props) {
  const { studioPane, report, analysisData, causalFactors, semanticTags, loading, onStudioPaneChange, onToggleCollapse, onAnalyze, onDownloadReport } = props;
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-slate-100 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Studio</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onDownloadReport} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-indigo-600" title="下载报告"><Download size={15} /></button>
          <button type="button" onClick={onToggleCollapse} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50" title="收起"><ChevronsRight size={16} /></button>
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">
        <StudioCard
          Icon={FileText}
          title="文字总结"
          desc="对数据和对话内容进行智能总结"
          accent="bg-sky-50 text-sky-500"
          active={studioPane === "summary"}
          onClick={() => onStudioPaneChange(studioPane === "summary" ? null : "summary")}
        />
        <StudioCard
          Icon={BarChart3}
          title="分析报告"
          desc="生成专业的增长分析报告"
          accent="bg-violet-50 text-violet-500"
          active={studioPane === "report"}
          onClick={() => onStudioPaneChange(studioPane === "report" ? null : "report")}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 thin-scrollbar">
        {studioPane === "summary" ? (
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2"><FileText size={15} className="text-sky-500" /><h3 className="text-sm font-semibold text-slate-800">文字总结</h3></div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-600">{report}</pre>
          </section>
        ) : studioPane === "report" ? (
          <div className="space-y-3">
            <MetricGrid data={analysisData} />
            <ChartSlot title="播放趋势概览" />
            <ChartSlot title="互动影响因子" compact />
            <CausalFactors factors={causalFactors} />
            <SemanticTags tags={semanticTags} />
            <button type="button" onClick={onAnalyze} disabled={loading.analyze} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60">
              {loading.analyze ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} 重新生成报告
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs leading-6 text-slate-400">
            <Sparkles size={18} className="mx-auto mb-2 text-slate-300" />
            Studio 输出将保存在此处<br />
            添加数据源后，点击上方功能即可开始生成内容
          </div>
        )}
      </div>
    </aside>
  );
}

function StudioCard({ Icon, title, desc, accent, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 ${active ? "border-indigo-200 bg-indigo-50/40" : "border-slate-100 bg-white shadow-sm"}`}
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accent}`}><Icon size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">{desc}</p>
      </div>
      <ArrowRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
    </button>
  );
}

function MetricGrid({ data }) {
  const metrics = [
    ["播放量", data?.data?.metrics?.avg_views ?? "—", "+12.4%"],
    ["互动热度", data?.video?.content_score ?? "—", "+8.6%"],
    ["完播潜力", data?.video?.virality_score ?? "—", "+5.2%"],
    ["语义标签", data?.knowledge?.semantic_tags?.length ?? "—", "+2.1%"],
  ];
  return (
    <section className="grid grid-cols-2 gap-3">
      {metrics.map(([label, value, trend]) => (
        <div key={label} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-medium text-slate-400">{label}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <span className="truncate text-base font-semibold text-slate-800">{typeof value === "number" ? value.toLocaleString() : value}</span>
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600"><TrendingUp size={10} />{trend}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function ChartSlot({ title, compact = false }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <h3 className="text-xs font-semibold text-slate-800">{title}</h3>
      <div className={`mt-3 overflow-hidden rounded-2xl bg-slate-50 ${compact ? "h-24" : "h-32"}`}>
        <div className="flex h-full items-end gap-1.5 px-3 pb-3">
          {[34, 58, 44, 72, 52, 88, 64, 92, 78].map((height, index) => (
            <span key={`${height}-${index}`} className="flex-1 rounded-t-xl bg-gradient-to-t from-indigo-500/70 to-violet-300/70" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CausalFactors({ factors }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold text-slate-800">播放影响因素</h3>
      <div className="space-y-2.5">
        {factors.length === 0 ? <p className="text-xs text-slate-400">等待分析结果...</p> : null}
        {factors.map((factor, index) => {
          const width = Math.max(8, Math.min(100, Number(factor.impact_weight || 0) * 100));
          return (
            <div key={`${factor.factor}-${index}`}>
              <div className="mb-1 flex justify-between gap-3 text-[11px] text-slate-500">
                <span className="truncate">{factor.factor}</span>
                <span>{Number(factor.confidence || 0).toFixed(2)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SemanticTags({ tags }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
      <h3 className="mb-2 text-xs font-semibold text-slate-800">弹幕 / 语义分析</h3>
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 ? <span className="text-xs text-slate-400">等待 KnowledgeAgent 输出...</span> : null}
        {tags.map((tag) => (
          <span key={tag.term} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-600">{tag.term} · {tag.sentiment}</span>
        ))}
      </div>
    </section>
  );
}

export default App;
