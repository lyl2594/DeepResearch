# 🦌 深思 DeepResearch — 多智能体深度研究系统

> 基于 LangGraph 的多智能体深度研究（Deep Research）系统，支持联网搜索、网页抓取、RAG 知识库增强、HITL 人工介入、研究报告自动生成与 Word 导出。

本项目的可视化的功能演示（无需运行即可查看）见 **[`docs/feature-demo.html`](./docs/feature-demo.html)**，直接双击用浏览器打开即可体验。

---

## 📌 目录

- [项目简介](#-项目简介)
- [核心功能](#-核心功能)
- [系统架构](#-系统架构)
- [目录结构](#-目录结构)
- [环境要求](#-环境要求)
- [快速开始](#-快速开始)
  - [1. 克隆项目](#1-克隆项目)
  - [2. 配置后端](#2-配置后端)
  - [3. 启动后端](#3-启动后端)
  - [4. 启动前端](#4-启动前端)
- [配置详解](#-配置详解)
  - [后端配置 .env / conf.yaml](#后端配置-env--confyaml)
  - [前端配置 .env](#前端配置-env)
  - [PostgreSQL 数据库](#postgresql-数据库)
- [使用指南](#-使用指南)
- [API 接口](#-api-接口)
- [运行测试](#-运行测试)
- [常见问题（FAQ）](#-常见问题faq)
- [License](#-license)

---

## 🌟 项目简介

深思（DeepResearch）是一个教学驱动的深度研究系统，核心是一个 **多智能体图编排（Multi-Agent Graph Orchestration）**：

1. **协调器（Coordinator）** 理解用户的研究问题与场景；
2. **规划器（Planner）** 拆解研究计划（信息收集 / 数据处理步骤）；
3. **研究执行团队（Research Team）** 由 **研究员（Researcher）**、**程序员（Coder）**、**评估器（Evaluator）** 组成，围绕计划逐步执行、自主调用工具并自我评估；
4. **报告生成器（Reporter）** 汇总所有研究结果，生成规范的 Markdown 研究报告；
5. **报告终评（Final Evaluator）** 对报告打分，不达标则触发 **反思循环（Reflection Loop）** 重新规划。

整个过程可选 **HITL（Human-in-the-Loop）** 人工介入——计划审核、知识库选择、报告验收均可暂停等待人工确认。

---

## ✨ 核心功能

| 模块 | 功能 |
| ---- | ---- |
| **多智能体编排** | coordinator → planner → research_team（researcher / coder / eval）→ reporter，LangGraph 状态机编排 |
| **联网搜索** | DuckDuckGo（免 Key，默认）/ Tavily（可选），研究者自动搜索并抓取网页正文（Jina / Readability） |
| **RAG 知识库增强** | 对接 AIHUB 知识库，检索增强（Rerank 重排），识别目标知识库并融合进研究过程 |
| **HITL 人工介入** | 计划审核、知识库选择、报告验收三类中断，前端可接受 / 修改 / 重跑 |
| **评估与反思** | 步骤级评分（Evaluator）+ 报告终评（Final Evaluator），质量不达标自动反思重规划 |
| **SSE 流式输出** | 前后端 SSE 逐事件推送，支持思考过程（思考区）、工具调用、活动卡片实时展示 |
| **会话管理** | 会话列表 / 回放 / 删除，刷新或重启后可回看历史对话 |
| **步骤跳过** | 研究中可跳过当前步骤（Skip），保持流程持续推进 |
| **MCP 动态工具** | 可选加载 MCP Server（安全开关默认关闭），动态扩展 Agent 工具 |
| **Word 报告导出** | 研究报告一键导出为 .docx，支持中英文编号模板 |
| **AIHUB 集成** | 知识库连接测试、资源拉取、自动选择目标库（自动 + 手动） |

---

## 🧠 系统架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────┐
│  前端          │     │  FastAPI 后端  │     │        LangGraph 图编排          │
│  Next.js 15    │     │  (SSE 流式)    │     │                              │
│  React 19      │ ──▶ │  0.0.0.0:8000  │ ──▶ │ START → coordinator → planner │
│  pnpm          │     │               │     │    → human_feedback (HITL)    │
└──────────────┘     └──────────────┘     │    → research_team             │
        │                    │             │       ├── researcher (搜索/抓取)│
        │                    │             │       ├── coder (Python 处理)   │
        │                    │             │       └── eval (步骤评分)       │
        │                    ▼             │    → reporter → report_review  │
        │        ┌──────────────┐          │    → final_report_evaluator    │
        │        │  PostgreSQL  │          │       └─ 达标 → END            │
        │        │ 业务表/检查点  │          │       └─ 低分 → planner(反思)   │
        └────────┴──────────────┴──────────┴──────────────────────────────┘
```

- **持久化**：业务表（对话分片 + 节点事件流水）用于产品可见数据回放；LangGraph `checkpointer`（AsyncPostgresSaver）用于开发态断点续跑。
- **语言控制**：`locale` 字段在 Coordinator → Planner → 各 Agent Prompt 中逐层传递，控制输出与内部推理的语言（zh-CN / en-US）。

---

## 📂 目录结构

```
chapter-10/
├── agents/          # 多智能体定义（研究团队各 Agent）
├── config/          # 全局配置（configuration.py、activities.py）
├── crawler/         # 网页抓取（Jina / Readability / Article）
├── database/        # SQLAlchemy 模型 / 仓库层（业务表与事件流水）
├── exercise/        # 教学配套文档（章节说明）
├── graph/           # LangGraph 状态、节点、图构建（核心编排）
├── prompts/         # 各 Agent 的 Prompt 模板（markdown）
├── rag/             # RAG：AIHUB、重排、检索、内存
├── server/          # FastAPI 应用、SSE 流式、MCP、RAG 配置服务
├── tests/           # 自动化测试（pytest）
├── tools/           # Agent 工具（搜索、抓取、Python REPL、检索）
├── utils/           # 上下文管理、JSON 修复、思考解析、计时
├── web/             # 前端（Next.js 15 / React 19 / pnpm）
├── conf.example.yaml   # 后端配置示例（复制为 conf.yaml 使用）
├── llm.py             # LLM 客户端封装（含禁思考的报告用 LLM）
├── main.py            # CLI 入口（带 HITL / 自动模式）
├── server.py          # HTTP 服务启动入口
├── pyproject.toml     # Python 依赖（uv 管理）
└── README.md
```

---

## 🔧 环境要求

| 依赖 | 版本要求 |
| ---- | ---- |
| Python | >= 3.12 |
| PostgreSQL | >= 14（含业务库 + checkpoint 库） |
| Node.js | >= 22.14.0 |
| 包管理器 | `uv`（Python）、`pnpm`（前端） |
| LLM | 任意 OpenAI 兼容的模型服务（本仓库默认 Qwen3-32B-FP8） |

> 💡 前端 README（[`web/README.md`](./web/README.md)）、后端依赖（[`pyproject.toml`](./pyproject.toml)）均提供了独立说明，可对照查阅。

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <你的仓库地址> mini-deepresearch
cd mini-deepresearch
```

### 2. 配置后端

复制环境变量示例与配置示例，并按需修改：

```bash
# Linux / macOS
cp .env.example .env
cp conf.example.yaml conf.yaml

# Windows (PowerShell)
Copy-Item .env.example .env
Copy-Item conf.example.yaml conf.yaml
```

> `.env` 与 `conf.yaml` 已被 `.gitignore` 排除，**不会**上传到 GitHub，请勿直接改 `.env.example` / `conf.example.yaml` 提交真实凭据。

然后在 `.env` 中至少填入：

```ini
# 你的 LLM（OpenAI 兼容）
BASIC_MODEL__base_url=http://your-llm-host:port/v1
BASIC_MODEL__model=Qwen3-32B-FP8
BASIC_MODEL__api_key=YOUR_API_KEY
BASIC_MODEL__token_limit=32768

# PostgreSQL 连接（业务库 + checkpointer 共用）
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres
CHECKPOINT_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
```

### 3. 启动后端

使用 `uv` 自动创建虚拟环境并安装依赖：

```bash
# 启动 HTTP 服务（默认 0.0.0.0:8000）
uv run server.py

# 换端口
PORT=9000 uv run server.py
```

> ⚠️ **Windows 注意**：请使用系统的 Python 3.12 环境（C 盘），避免使用 Anaconda（不稳定）。`pyproject.toml` 使用 `uv` 管理依赖，首次运行会自动创建 `.venv` 并安装所需包。

### 4. 启动前端

```bash
cd web
pnpm install
cp .env.example .env   # Windows: Copy-Item .env.example .env
pnpm dev
```

浏览器访问 **http://localhost:3000**。默认前端通过 `NEXT_PUBLIC_API_URL`（默认 `http://localhost:8000/api`）代理到后端。

---

## ⚙️ 配置详解

### 后端配置 `.env` / `conf.yaml`

后端配置支持两层加载方式，**优先级：环境变量（`BASIC_MODEL__<key>`）> `conf.yaml` > 内置默认值**。`.env.example` 和 `conf.example.yaml` 内容基本一致，二选一填写即可。

| 配置项 | 说明 | 示例 / 默认值 |
| ---- | ---- | ---- |
| `BASIC_MODEL__base_url` | LLM 服务地址（OpenAI 兼容） | `http://host:port/v1` |
| `BASIC_MODEL__model` | 模型名 | `Qwen3-32B-FP8` |
| `BASIC_MODEL__api_key` | API Key |（真实生产：请用环境变量注入）|
| `BASIC_MODEL__token_limit` | 上下文上限（ContextManager 用，缺省则上下文管理失效） | `32768` |
| `SEARCH_API` | 搜索引擎（`duckduckgo` / `none`） | `duckduckgo` |
| `DEBUG` | 调试开关 | `True` |
| `ENABLE_PYTHON_REPL` | 是否启用 Python REPL 工具（Coder Agent） | `true` |
| `ENABLE_MCP_SERVER_CONFIGURATION` | MCP 动态工具安全开关（建议生产保持 `false`） | `false` |
| `DATABASE_URL` | 业务库连接串（SQLAlchemy + psycopg3） | `postgresql+psycopg://...` |
| `CHECKPOINT_DB_URL` | checkpoint 库连接串（psycopg 原生） | `postgresql://...` |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE` | 连接池参数 | `10` / `20` / `3600` |
| `CORS_ALLOW_ORIGINS` | 跨域白名单（逗号分隔） | `http://localhost:3000,...` |
| `PORT` / `HOST` | 服务端口与监听地址 | `8000` / `0.0.0.0` |
| `AIHUB_API_URL` 等 | AIHUB 知识库凭据（实战可选） | 留空默认关闭 RAG |

**Rerank 重排（RAG 增强检索）** 在 `conf.example.yaml` 的 `RERANK_MODEL` 段配置（当前提供 `emb` 格式，实战可用）。

### 前端配置 `.env`

`web/.env`（由 `web/.env.example` 复制而来）：

| 配置项 | 说明 | 示例 |
| ---- | ---- | ---- |
| `NEXT_PUBLIC_API_URL` | 后端 API 地址（代理目标） | `http://localhost:8000/api` |
| `GITHUB_OAUTH_TOKEN` | GitHub OAuth（教学版留空即可） | 空 |

> 若后端不在本机，把 `NEXT_PUBLIC_API_URL` 指向部署的后端即可。

### PostgreSQL 数据库

数据库在服务启动时**自动建表**（`init_db()`），无需手动执行 SQL。需确保 PostgreSQL 已启动且账号有建表权限：

```sql
-- 可用默认 postgres 库，也可另行创建
CREATE DATABASE postgres;
```

如需独立业务库，只需修改 `.env` 中 `DATABASE_URL` 对应的库名。

---

## 🎮 使用指南

### Web 界面（推荐）

打开 `http://localhost:3000`，输入研究问题，即可看到完整研究流程：

1. **计划生成**：协调器理解问题 → 规划器输出研究计划（弹窗可审核/修改，即 HITL）；
2. **研究执行**：研究员并行搜索、抓取网页；程序员用 Python 处理数据；评估器对每步打分；点击「跳过」可跳过当前步骤；
3. **过程可视化**：思考区（模型推理）、工具调用、活动卡片、进度追踪实时更新；
4. **报告生成**：汇总为 6 段式 Markdown 报告（标题/摘要/背景/分析/结论/参考），可一键导出 Word；
5. **会话管理**：历史会话列表、回放、删除。

### CLI 方式

```bash
# 自动模式（跳过人工确认）
uv run main.py --auto "你的研究问题"

# 带 HITL 模式（计划/报告处会暂停等待输入）
uv run main.py "你的研究问题"
#   计划处：输入 [ACCEPTED] 接受 / [EDIT_PLAN] 重新规划
#   报告处：输入 [ACCEPTED] 验收 / [CONTINUE] 重新生成
```

---

## 📡 API 接口

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/chat/stream` | 聊天流式端点（SSE 逐事件推送） |
| `POST` | `/api/chat/skip` | 跳过当前研究步骤 |
| `GET` | `/api/conversations` | 会话列表 |
| `GET` | `/api/conversation/{thread_id}` | 会话回放（SSE 文本） |
| `DELETE` | `/api/conversation/{thread_id}` | 删除会话（含 checkpoint） |
| `GET` | `/api/conversation/{thread_id}/events` | 节点事件流水（业务可观测） |
| `POST` | `/api/graph/report` | 导出研究报告为 Word |
| `GET` | `/api/config` / `/api/templates` | 前端启动探测（stub） |
| `GET/POST/PUT/DELETE` | `/api/config/rag/*` | RAG 知识库配置管理 |
| `POST` | `/api/config/rag/test_connection` | 知识库连接测试（AIHUB 真实连接） |
| `GET` | `/api/rag/resources` | 知识库资源查询 |
| `POST` | `/api/mcp/server/metadata` | MCP Server 元数据探测（需开启开关） |

---

## ✅ 运行测试

```bash
# 安装 dev 依赖后运行测试
uv sync --extra dev
uv run pytest tests/ -v
```

主要测试覆盖：上下文管理、SSE 流式契约、步骤跳过契约、增量契约、MCP 元数据、RAG 配置 API、AIHUB 集成。

---

## ❓ 常见问题（FAQ）

**Q1：前端无法连接后端？**
确保后端已启动（`uv run server.py`），并检查 `web/.env` 的 `NEXT_PUBLIC_API_URL` 是否指向正确的后端地址。

**Q2：研究过程报 GraphRecursionError（超出递归限制）？**
可通过环境变量提高递归上限：

```bash
set AGENT_RECURSION_LIMIT=100   # Windows PowerShell
export AGENT_RECURSION_LIMIT=100  # Linux / macOS
```

**Q3：Windows 下服务启动报 psycopg 异步兼容错误？**
`server.py` 已内置 Windows 兼容处理（使用 `SelectorEventLoop`）。请务必用系统的 Python 3.12（C 盘），勿用 Anaconda。

**Q4：MCP 相关接口返回 403？**
MCP 动态工具加载默认关闭。如需启用，在 `.env` 设置 `ENABLE_MCP_SERVER_CONFIGURATION=true`（注意：会带来任意命令执行的潜在风险）。

**Q5：报告为什么要用 `get_report_llm()`？**
报告生成使用关闭思考的 LLM 配置，确保最终报告只包含完整、组织化的内容，不夹带中间推理草稿。

**Q6：RAG 知识库不可用时怎么办？**
未配置 AIHUB（或连接失败）时，系统自动降级为纯联网搜索 + LLM 兜底，研究仍可正常完成。

---

## 🔗 License

本项目基于 MIT 协议开源。前端 UI 源自 [DeerFlow](https://github.com/bytedance/deepResearch)（MIT）。