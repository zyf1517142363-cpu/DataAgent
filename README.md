# AI Media Growth Agent

> 基于因果归因与多智能体协同的 B 站内容增长分析系统  
> FastAPI + React + 多阶段 Agent Workflow

---

## Overview

这是一个从 Demo 逐步走向产品化的 AI 分析项目，聚焦 B 站内容增长场景：

- 支持上传真实 CSV 数据（播放/点赞/评论等）
- 支持输入真实 B 站视频链接并抓取公开元数据与字幕/简介
- 通过多智能体流程输出可解释的增长策略
- 支持聊天追问和报告导出

---

## Features

- **真实数据输入**
  - CSV 上传与指标统计（`views / likes / comments / duration`）
  - B 站视频链接解析（BV 识别、公开元数据抓取、字幕/简介提取）
- **多智能体分析链路**
  - `DataAgent`、`VideoAnalysisAgent`、`AnalysisAgent`
  - `CounterfactualAgent`、`KnowledgeAgent`、`StrategyAgent`、`ReportAgent`
- **可解释输出**
  - 因果因子、置信度、反事实场景、执行策略
- **双路问答能力**
  - 前端可接入本地/API 大模型
  - 后端可使用摘要上下文兜底问答
- **工程化细节**
  - 会话隔离（`session_id`）
  - Timeout + 降级兜底
  - Markdown 报告下载

---

## Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, Lucide Icons
- **Backend:** FastAPI, Uvicorn, Pydantic
- **Data:** Pandas
- **HTTP:** httpx
- **Runtime:** Python 3.10+ / Node.js 18+

---

## Architecture

```text
CSV/Video Input
   -> /upload, /video
   -> /analyze
      -> DataAgent + VideoAnalysisAgent (parallel)
      -> Analysis -> Counterfactual -> Knowledge -> Strategy -> Report (serial)
   -> Report + Structured Data + Chat Summary
   -> /chat (LLM or fallback)
```

---

## Quick Start

### 1) One-click (Windows)

直接运行项目根目录脚本：

```bash
start-system.bat
```

脚本会启动后端与前端，并打开 `http://localhost:5173/`。

### 2) Manual Start

#### Backend

```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
npm install
npm run dev
```

默认前端请求 `http://127.0.0.1:8000`。如需修改：

```bash
VITE_API_BASE=http://127.0.0.1:8000 npm run dev
```

---

## API Reference

### `POST /upload`

上传 CSV（`multipart/form-data`）：

- `session_id`
- `file`

返回样例：

```json
{
  "video_count": 24,
  "avg_views": 135200,
  "like_rate": 0.084,
  "comment_rate": 0.016,
  "status": "success"
}
```

### `POST /video`

输入视频链接并载入元信息：

```json
{
  "session_id": "session_xxx",
  "url": "https://www.bilibili.com/video/BVxxxxxxxxxx"
}
```

返回包含标题、标签、字幕/简介文本、B 站公开统计等字段。  
若链接不可用或未识别 BV，会返回明确错误信息。

### `POST /analyze`

触发多智能体分析：

```json
{
  "session_id": "session_xxx"
}
```

返回：

- `report`：Markdown 报告正文
- `data`：结构化 Agent 输出
- `report_llm`：是否由服务端 LLM 重写报告

### `POST /chat`

基于会话摘要进行追问：

```json
{
  "session_id": "session_xxx",
  "question": "标题应该怎么改？"
}
```

---

## Configuration

### Frontend LLM (聊天用)

在页面中可配置：

- 本地模型网关（如 Ollama OpenAI-compatible endpoint）
- API 模式（`base_url + api_key + model`）

### Server LLM (报告重写，可选)

后端环境变量：

- `OPENAI_API_KEY` 或 `ANALYSIS_LLM_API_KEY`
- `ANALYSIS_LLM_BASE_URL`（可选，默认 `https://api.openai.com/v1`）
- `ANALYSIS_LLM_MODEL`（可选，默认 `gpt-4o-mini`）

> 未配置以上变量时，系统仍可运行，报告将使用结构化模板生成。

---

## Project Structure

```text
.
├─ app.py                 # FastAPI backend + multi-agent workflow
├─ src/App.jsx            # Frontend UI and interaction logic
├─ knowledge_base.json    # Domain terms for semantic enhancement
├─ requirements.txt       # Python dependencies
├─ package.json           # Frontend dependencies/scripts
└─ start-system.bat       # Windows one-click startup
```

---

## Notes

- 当前分析核心基于 **文本与结构化数据**（字幕/简介 + CSV），不是逐帧视觉理解。
- B 站链接建议直接复制完整视频页链接，保持 BV 大小写不变。
- 会话数据目前使用内存存储（`app.state.memory_db`），重启后会清空。

---

## Roadmap

- [ ] 引入持久化存储（Session/Project 数据落盘）
- [ ] 加入评测集与自动回归（报告质量、事实一致性）
- [ ] 增强可观测性（链路追踪、耗时与成本统计）
- [ ] 更强的工具化 Agent 回路（动态工具选择与自我修正）

---

## License

项目内含 `LICENSE` 文件，使用前请确认授权范围。
