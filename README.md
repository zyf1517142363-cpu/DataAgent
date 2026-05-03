# AI自媒体数据分析与增长策略Agent Demo

一个用于答辩展示的稳定版 Demo：FastAPI 后端 + React/Vite/Tailwind 前端。

## 一键启动

Windows 下直接双击项目根目录的：

```bash
start-system.bat
```

脚本会同时启动后端、前端，并自动打开 `http://localhost:5173/`。

## 启动后端

```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## 启动前端

```bash
npm install
npm run dev
```

默认前端请求 `http://127.0.0.1:8000`。如需修改：

```bash
VITE_API_BASE=http://127.0.0.1:8000 npm run dev
```

## 核心接口

- `POST /upload`：上传 CSV，表单字段 `session_id` + `file`
- `POST /video`：输入视频 URL 或场景，返回固定 Mock 元数据与字幕
- `POST /analyze`：并发运行 DataAgent 与 VideoAnalysisAgent，再串行完成因果归因、反事实推演、知识库增强、策略和报告
- `POST /chat`：仅使用压缩后的 `chat_context_summary` 回答追问

所有会话数据存放在 `app.state.memory_db`，按 `session_id` 隔离，不使用数据库。
