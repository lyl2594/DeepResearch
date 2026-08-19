"""第8章 FastAPI 服务：SSE 流式 + 会话生命周期。

从脚本变服务的关键一章。SSE 五层链（简化自 deepResearch server/app.py）：
  1. /api/chat/stream        —— 端点，返回 StreamingResponse(text/event-stream)
  2. _astream_workflow_generator —— 生成器主循环（回显输入 + resume + 调五层链）
  3. _stream_graph_events     —— graph.astream(stream_mode=["messages","updates"], subgraphs=True)
  4. _process_message_chunk   —— chunk → SSE 事件（message_chunk/tool_calls/tool_call_result/interrupt/error）
  5. _make_event              —— 打 SSE 帧（event: X\\ndata: {json}\\n\\n）+ 落库

会话生命周期：业务表 ChatStream（对话全文分片）+ LanggraphEvent（节点事件流水）。
vs checkpointer：业务表存"产品可见的结构化数据"（刷新/重启可回看），checkpointer 存"开发态 resume 状态"。
"""
import json
import logging
import os
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage, ToolMessage
from langgraph.types import Command
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.configuration import get_recursion_limit
from config.activities import ActivityType
from database import repository
from database.base import SessionLocal, get_db, init_db
from graph.builder import graph
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool
from server.chat_request import ChatRequest, SkipRequest
from server.mcp_utils import is_mcp_enabled, load_mcp_tools
from server.rag_config_service import rag_config_service
from server.rag_request import RAGConfigPayload, RAGConnectionPayload
from server.thread_state_manager import thread_state_manager
from utils.json_utils import sanitize_args
from utils.think_parser import ThinkContentParser

logger = logging.getLogger(__name__)

try:
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.section import WD_ORIENTATION
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False
    logger.warning("python-docx not installed, Word export will be disabled")

_checkpoint_pool: AsyncConnectionPool | None = None

app = FastAPI(title="mini-deepresearch", version="0.8.0")
cors_origins = [origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]

# CORS：前端跨域（生产应收敛白名单）
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    init_db()
    global _checkpoint_pool
    _checkpoint_pool = AsyncConnectionPool(
        conninfo=os.getenv("CHECKPOINT_DB_URL"),
        kwargs={"autocommit": True, "prepare_threshold": 0},
        min_size=2,
        max_size=10,
        open=False,
    )
    await _checkpoint_pool.open()
    saver = AsyncPostgresSaver(_checkpoint_pool)
    await saver.setup()
    graph.checkpointer = saver
    logger.info("checkpointer: AsyncPostgresSaver 已挂载到 graph")


@app.on_event("shutdown")
async def _shutdown():
    global _checkpoint_pool
    if _checkpoint_pool:
        await _checkpoint_pool.close()
        _checkpoint_pool = None
        logger.info("checkpointer: 连接池已关闭")


# ============ 1. chat_stream 端点 ============

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """聊天流式端点：逐事件 SSE 推送。"""
    # 本章 MCP 增量：安全开关（默认关，避免任意命令执行风险）
    if request.mcp_settings and not is_mcp_enabled():
        raise HTTPException(
            status_code=403,
            detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true",
        )
    thread_id = request.thread_id or str(uuid4())
    return StreamingResponse(
        _astream_workflow_generator(request, thread_id),
        media_type="text/event-stream",
    )


# ============ 2. _astream_workflow_generator（生成器主循环）============

async def _astream_workflow_generator(request: ChatRequest, thread_id: str):
    """组装 workflow_input（含 HITL resume）→ 调五层链。

    注意：user 消息不主动 yield 回前端——前端 sendMessage 已本地 append user 气泡（无延迟感），
    再 yield 会让前端追加两条相同气泡（重复渲染）。但仍调 _make_event 把 user 消息**落业务表**，
    让 GET /api/conversation/{thread_id} 历史回放时能重放完整对话（含用户提问）。
    对齐主项目 deer-flow-aw/src/server/app.py 的 _process_initial_messages 做法。
    """
    # user 消息只落库不 yield（避免与前端本地 append 重复）
    for msg in request.messages:
        if isinstance(msg, dict) and msg.get("content"):
            _make_event(
                "message_chunk",
                {
                    "thread_id": thread_id,
                    "id": "run--" + uuid4().hex,
                    "role": "user",
                    "content": msg["content"],
                },
            )  # 只落库，不 yield

    # 组装输入
    if request.interrupt_feedback:
        # HITL resume：反馈类型决定路由，最新消息保留用户的具体修改要求。
        resume_message = f"[{request.interrupt_feedback}]"
        if request.messages:
            latest_content = request.messages[-1].get("content", "")
            if latest_content:
                resume_message += f" {latest_content}"
        workflow_input = Command(
            resume=resume_message,
            update={"edited_plan": request.plan, "param_list": request.param_list},
        )
    else:
        workflow_input = {
            "messages": request.messages,
            "auto_accepted_plan": request.auto_accepted_plan,
            "param_list": request.param_list,
        }

    workflow_config = {
        "configurable": {
            "thread_id": thread_id,
            "max_plan_iterations": request.max_plan_iterations,
            "max_step_num": request.max_step_num,
            "max_search_results": request.max_search_results,
            # 前端字段 → 后端 Configuration 字段名映射（None 则保留 Configuration 默认值）
            **({"min_quality_score": request.min_step_score} if request.min_step_score is not None else {}),
            **({"max_step_iterations": request.max_step_retry} if request.max_step_retry is not None else {}),
            "mcp_settings": request.mcp_settings or {},

            "resources": request.resources or [],


            "rag_configs": request.rag_configs if request.enable_rag else [],

            "enable_background_investigation": request.enable_background_investigation,
            "enable_web_search": request.enable_web_search,
            "enable_rag": request.enable_rag,
            "auto_select_kb": request.auto_select_kb,
            "retriever_similarity": request.retriever_similarity,
            "retriever_limit": request.retriever_limit,
            "report_style": request.report_style,
        },
        "recursion_limit": get_recursion_limit(),
    }

    async for event in _stream_graph_events(graph, workflow_input, workflow_config, thread_id):
        yield event


# ============ 3. _stream_graph_events（graph.astream 三流模式）============

def _process_tool_call_chunks(tool_call_chunks):
    """Process tool call chunks and sanitize arguments.

    直接对齐主项目 reference-source/deer-flow-aw/src/server/app.py。
    """

    chunks = [ ]

    for chunk in tool_call_chunks:
        chunks.append(
            {
                "name": chunk.get("name", ""),
                "args": sanitize_args(chunk.get("args", "")),
                "id": chunk.get("id", ""),
                "index": chunk.get("index", 0),
                "type": chunk.get("type", ""),
            }
        )
    return chunks


async def _get_current_state(graph_instance, thread_id):
    """Get current graph state for the given thread.

    直接对齐主项目：interrupt 事件需要从 state 读取 step / step_title。
    """
    safe_config = {
        "configurable": {
            "thread_id": thread_id,
            "checkpoint_ns": "",
        }
    }
    return await graph_instance.aget_state(safe_config)


async def _stream_graph_events(graph_instance, workflow_input, workflow_config, thread_id):
    """消费 graph.astream，按事件类型分流处理。

    stream_mode=["messages","updates"]：
      - messages 流产出 (message_chunk, metadata) tuple → _process_message_chunk
      - updates 流产出 dict（含可能的 __interrupt__）→ interrupt 事件
    subgraphs=True：拿到 ReAct 子图内部事件（agent 自主多轮的工具调用）。
    """
    think_parser = ThinkContentParser()
    try:
        async for item in graph_instance.astream(
            workflow_input,
            config=workflow_config,
            stream_mode=["messages", "updates", "custom"],
            subgraphs=True,
        ):
            # 兼容不同 langgraph 版本的产出元组长度（2 或 3）
            if not isinstance(item, (tuple, list)) or len(item) < 2:
                continue
            event_data = item[-1]  # 最后一项是数据
            # 多 stream_mode + subgraphs=True 时首项是子图命名空间，
            # 例如 ("researcher:<task-id>",)。内部 metadata.langgraph_node 通常只是 "agent"，
            # 必须保留命名空间才能让前端识别真正的 researcher。
            agent_path = item[0] if len(item) >= 3 else ()
            current_state = await _get_current_state(graph_instance, thread_id)

            # interrupt（updates 模式的 dict 含 __interrupt__）
            if isinstance(event_data, dict) and "__interrupt__" in event_data:
                yield _create_interrupt_event(thread_id, event_data, current_state)
                continue

            # 对齐原项目：skip 状态生效期间不再向前端转发
            # 当前 ReAct 步骤的后续 chunk，避免点击后继续新增搜索卡。
            if thread_state_manager.get_skip_state(thread_id):
                continue

            # messages 流：event_data = (message_chunk, metadata)
            # 注意：evaluation 事件不在此 updates 分支单独推送——
            # final_report_evaluator_node 已把 evaluation_data 塞进 AIMessage.additional_kwargs，
            # 走 messages 流自然吐出，由 _process_message_chunk 识别 agent_name 后转成 event: evaluation
            if isinstance(event_data, tuple) and len(event_data) == 2:
                message_chunk, metadata = event_data
                if getattr(message_chunk, "content", None):
                    clean_content, think_content = think_parser.process_chunk(
                        message_chunk.content
                    )
                    message_chunk.content = clean_content
                    if think_content is not None:
                        message_chunk.additional_kwargs = {
                            **(getattr(message_chunk, "additional_kwargs", None) or {}),
                            "reasoning_content": think_content,
                        }
                async for evt in _process_message_chunk(
                    message_chunk,
                    metadata,
                    thread_id,
                    current_state,
                    agent_path=agent_path,
                ):
                    yield evt
    except Exception as e:
        logger.exception(f"[stream] graph 执行异常: {e}")
        yield _make_event("error", {"thread_id": thread_id, "error": str(e)})


# ============ 3.5. _create_interrupt_event（HITL interrupt 事件）============

def _create_interrupt_event(thread_id, event_data, state):
    """通过 value 中的 type 字段区分中断类型。

    直接对齐主项目 reference-source/deer-flow-aw/src/server/app.py；
    仅对本章 LangGraph 版本可能返回空 ns 做 ID 兜底。
    """
    interrupt_obj = event_data["__interrupt__"][0]
    interrupt_value = interrupt_obj.value

    node_type = interrupt_value.get("type", "unknown")
    re_execute_times = interrupt_value.get("re_execute_times", -1)

    if node_type == "plan_review":
        options = [
            {"text": "修改计划", "value": "edit_plan"},
            {"text": "开始研究", "value": "accepted"},
        ]
    elif node_type == "retriever_review":
        options = [
            {"text": "Continue", "value": "continue"},
            {"text": "Reselect Resources", "value": "reselect"},
        ]
    elif node_type == "report_review":
        options = [
            {"text": "接受报告", "value": "accepted"},
            {"text": "重新生成", "value": "continue"},
        ]
    else:
        options = [{"text": "Continue", "value": "continue"}]


    interrupt_ns = getattr(interrupt_obj, "ns", None) or [ ]

    event_data_dict = {
        "thread_id": thread_id,
        "role": "assistant",
        "content": interrupt_value["message"],
        "node_type": node_type,
        "finish_reason": "interrupt",
        "options": options,
        "id": interrupt_ns[0] if interrupt_ns else "intr--" + uuid4().hex,
        "step": state.values.get("step", ""),
        "step_title": state.values.get("step_title", ""),
        "additional_info": {
            "re_execute_times": re_execute_times,
            **(
                {"retrieval_review": interrupt_value.get("review_data")}
                if interrupt_value.get("review_data") is not None
                else {}
            ),
        },
    }

    return _make_event("interrupt", event_data_dict)


# ============ 4. _process_message_chunk（chunk → SSE 事件）============

def _get_agent_name(agent_path, metadata) -> str:
    """优先从子图命名空间还原业务节点名，回退到消息 metadata。"""
    if agent_path and len(agent_path) > 0:
        first = str(agent_path[0])
        return first.split(":", 1)[0]
    return (metadata or {}).get("langgraph_node", "")


async def _process_message_chunk(
    message_chunk, metadata, thread_id, state, agent_path=()
):
    """把单个消息 chunk 转成前端可消费的 SSE 事件。"""
    # 跳过用户输入回显（已在前面处理）
    if isinstance(message_chunk, HumanMessage):
        return

    meta = metadata or {}
    agent_name = _get_agent_name(agent_path, meta)
    msg_id = getattr(message_chunk, "id", None) or "run--" + uuid4().hex
    state_values = getattr(state, "values", {}) or {}
    current_plan = state_values.get("current_plan")
    step_iterations = 0
    if agent_name in ("researcher", "coder", "eval"):
        step_str = state_values.get("step", "")
        try:
            step_index = int(str(step_str).removeprefix("step"))

            steps = current_plan.steps if hasattr(current_plan, "steps") else [ ]

            step_iterations = steps[step_index].step_iterations
        except (AttributeError, IndexError, TypeError, ValueError):
            step_iterations = 0

    base = {
        "thread_id": thread_id,
        "id": msg_id,
        "agent": agent_name,
        "role": "assistant",
        "step": state_values.get("step", ""),
        "step_title": state_values.get("step_title", ""),
        "additional_info": (
            {"re_execute_times": step_iterations}
            if agent_name in ("researcher", "coder", "eval")
            else {}
        ),
    }

    # evaluation 事件（直接对齐主项目做法）：
    # eval / final_report_evaluator 内部 structured-output token 不属于聊天正文，
    # 只有节点显式写入 evaluation_data 的 AIMessage 才转成 event: evaluation。
    additional_kwargs = getattr(message_chunk, "additional_kwargs", None) or {}
    reasoning_content = additional_kwargs.get("reasoning_content")
    if reasoning_content:
        base["reasoning_content"] = reasoning_content

    activity = additional_kwargs.get("activity")
    if activity:
        base["additional_info"]["activity"] = activity
    elif agent_name == "researcher":
        base["additional_info"]["activity"] = {
            "activity_type": ActivityType.EXECUTE_RESEARCH.type,
            "activity_name": ActivityType.EXECUTE_RESEARCH.description,
        }
    elif agent_name == "eval":
        base["additional_info"]["activity"] = {
            "activity_type": ActivityType.EVALUATE_RESEARCH.type,
            "activity_name": ActivityType.EVALUATE_RESEARCH.description,
        }

    if agent_name in ("eval", "final_report_evaluator"):
        if additional_kwargs.get("evaluation_data"):
            base["content"] = message_chunk.content or ""
            base["evaluation_data"] = additional_kwargs["evaluation_data"]
            re_execute_times = additional_kwargs.get("re_execute_times")
            if re_execute_times is not None:
                base["additional_info"]["re_execute_times"] = re_execute_times
            finish_reason = getattr(message_chunk, "response_metadata", {}).get("finish_reason")
            if finish_reason and finish_reason != "none":
                base["finish_reason"] = finish_reason
            yield _make_event("evaluation", base)
        elif activity:
            base["content"] = message_chunk.content or ""
            yield _make_event("message_chunk", base)
        return

    if isinstance(message_chunk, ToolMessage):
        # 工具返回结果
        base["tool_call_id"] = message_chunk.tool_call_id
        base["content"] = message_chunk.content
        yield _make_event("tool_call_result", base)
    elif isinstance(message_chunk, AIMessageChunk):
        # AI Message - Raw message tokens
        if message_chunk.tool_calls:
            # AI Message - Tool Call
            base["tool_calls"] = message_chunk.tool_calls
            base["tool_call_chunks"] = _process_tool_call_chunks(
                message_chunk.tool_call_chunks
            )
            base["content"] = message_chunk.content or ""
            yield _make_event("tool_calls", base)
        elif message_chunk.tool_call_chunks:
            # AI Message - Tool Call Chunks
            base["tool_call_chunks"] = _process_tool_call_chunks(
                message_chunk.tool_call_chunks
            )

            # 对齐主项目：带工具名的首段同时作为 tool_calls，后续无名片段走 tool_call_chunks。
            has_tool_call_chunk_name = any(
                chunk.get("name", "") for chunk in message_chunk.tool_call_chunks
            )
            event_type = (
                "tool_calls" if has_tool_call_chunk_name else "tool_call_chunks"
            )
            if has_tool_call_chunk_name:
                base["tool_calls"] = message_chunk.tool_call_chunks
            yield _make_event(event_type, base)
        else:
            # AI Message - Raw message tokens
            base["content"] = message_chunk.content or ""
            finish_reason = meta.get("finish_reason") or getattr(message_chunk, "response_metadata", {}).get("finish_reason")
            if finish_reason and finish_reason != "none":
                base["finish_reason"] = finish_reason
            yield _make_event("message_chunk", base)


# ============ 5. _make_event（SSE 帧 + 落库）============

def _make_event(event_type: str, data: dict) -> str:
    """构造 SSE 帧（event: X\\ndata: {json}\\n\\n）并落库业务表。"""
    thread_id = data.get("thread_id", "")
    if data.get("content") == "":
        data.pop("content", None)
    try:
        json_data = json.dumps(data, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        logger.error(f"[sse] 序列化失败: {e}")
        json_data = json.dumps({"error": "Serialization failed"}, ensure_ascii=False)

    finish_reason = data.get("finish_reason", "none")
    # 落库：每个 SSE 帧存一行（刷新/重启后可回看）
    db = SessionLocal()
    try:
        repository.append_chat_stream(db, thread_id, event_type, json_data, finish_reason)
    except Exception as e:
        logger.warning(f"[sse] 落库失败（不影响流式）: {e}")
    finally:
        db.close()

    return f"event: {event_type}\ndata: {json_data}\n\n"


# ============ 会话生命周期 API（list / get / delete）============

@app.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db)):
    """列出所有会话（thread_id 去重 + 最后更新时间）。"""
    return {"data": repository.list_conversations(db)}


@app.get("/api/conversation/{thread_id}")
def get_conversation(thread_id: str, db: Session = Depends(get_db)):
    """获取某会话的全部事件（前端回放用）。"""
    rows = repository.get_conversation(db, thread_id)
    replay = "".join(f"event: {row['event_type']}\ndata: {row['content']}\n\n" for row in rows)
    return PlainTextResponse(replay, media_type="text/plain")


@app.delete("/api/conversation/{thread_id}")
async def delete_conversation(thread_id: str, db: Session = Depends(get_db)):
    """删除会话的回放事件与 LangGraph checkpoint。"""
    try:
        await graph.checkpointer.adelete_thread(thread_id)
        repository.delete_conversation(db, thread_id)
        return {
            "thread_id": thread_id,
            "deleted": True,
            "message": "Conversation deleted successfully",
        }
    except Exception as e:
        logger.exception(f"[conversation] 删除失败: {e}")
        return {
            "thread_id": thread_id,
            "deleted": False,
            "message": f"Error deleting conversation: {e}",
        }


# ============ 第9章：前后端协作（skip 控制 + 业务可观测）============

@app.post("/api/chat/skip")
def skip_chat(request: SkipRequest):
    """跳过当前研究步骤：设置 skip 状态，graph 继续跑（不停）。

    _execute_agent_step 执行前检查 skip，跳过当前 step 但 graph 推进到下一步。
    区别于 cancel：skip 保留状态完整更新（步骤断点续），graph 跑完整个流程。
    """
    thread_state_manager.set_skip_state(request.thread_id, should_skip=True)
    return {"thread_id": request.thread_id, "skip_set": True, "message": "已请求跳过当前步骤"}


@app.get("/api/conversation/{thread_id}/events")
def get_graph_events_api(thread_id: str, db: Session = Depends(get_db)):
    """节点事件流水（业务可观测：无 LangSmith 也能复盘节点轨迹，合规行业必备）。"""
    return repository.get_graph_events(db, thread_id)


# ============ 前端对接 stub 端点 ============
# 前端骨架启动时会调这些端点。本章后端只做当前主题相关的实现，
# 用 stub 让前端不崩即可。后续章节陆续实现真实逻辑。

@app.get("/api/config")
def get_config_stub():

    return {"rag": {"provider": "memory"}, "models": {"basic": ["Qwen3-32B-FP8"], "reasoning": []}}



@app.get("/api/templates")
def list_templates_stub():

    return [ ]



@app.get("/api/config/rag/get_config")
def get_rag_config(db: Session = Depends(get_db)):
    # 契约对齐主项目 reference-source/deer-flow-aw/src/server/api/rag.py:99：
    # 直接返回 list[dict]（前端 knowledge-tab.tsx 用 configs.map 消费）。
    return rag_config_service.list_configs(db)


@app.post("/api/config/rag/save_config")
def save_rag_config(payload: RAGConfigPayload, db: Session = Depends(get_db)):
    # 契约对齐主项目 rag.py:83-92：直接返回配置对象（前端读 result.id）。
    return rag_config_service.create(db, payload)


@app.put("/api/config/rag/{config_id}")
def update_rag_config(config_id: str, payload: dict, db: Session = Depends(get_db)):
    updated = rag_config_service.update(db, config_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="知识库配置不存在")
    return updated


@app.delete("/api/config/rag/{config_id}")
def delete_rag_config(config_id: str, db: Session = Depends(get_db)):
    return {"deleted": rag_config_service.delete(db, config_id), "id": config_id}


@app.post("/api/config/rag/test_connection")
def test_rag_connection(payload: RAGConnectionPayload):
    # aihub 平台走真实连接（登录 + 拉资源列表），暴露账号密码/网络等真实错误。
    # 其它平台保留结构校验的 stub 行为（教程不实现真连接，诚实标注）。
    if payload.platform == "aihub":
        from rag.aihub import AIHubProvider

        # logger.info(f"测试连接ihub 配置: {payload}")

        provider = AIHubProvider(
            api_url=payload.api_url,
            username=payload.ext_config.get("username", ""),
            password=payload.ext_config.get("password", ""),
        )
        return provider.test_connection()

    # 非 aihub：仅结构校验，不代表真连成功

    resources = payload.ext_config.get("resources", [])

    return {
        "success": True,
        "resource_count": len(resources),
        "message": f"{payload.platform} 配置校验通过（stub，仅结构校验）",
    }


@app.get("/api/rag/resources")
def query_rag_resources(query: str = "", db: Session = Depends(get_db)):
    return {"resources": rag_config_service.query_resources(db, query)}


@app.post("/api/mcp/server/metadata")
async def mcp_server_metadata(payload: dict):
    if not is_mcp_enabled():
        raise HTTPException(status_code=403, detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true")
    # 白名单过滤：langchain-mcp-adapters 的 _create_stdio_session 只接受
    # transport/command/args/url/env/headers 等启动参数，收到 `name` 之类的额外键会 TypeError。
    # 保持与 nodes.py:481-483 主加载路径同款过滤，避免预览路径独有的字段污染。
    connection = {
        k: v for k, v in payload.items()
        if k in ("transport", "command", "args", "url", "env", "headers") and v is not None
    }
    tools = await load_mcp_tools({"preview": connection}, timeout_seconds=15)
    # 契约对齐主项目 reference-source/deer-flow-aw/src/server/app.py:980-988：
    # 回传前端 POST 上来的启动字段（transport/command/args/url/env/headers），
    # 前端 add-mcp-server-dialog.tsx:116 `{...metadata, name, enabled}` 靠这些字段
    # 把完整 server 描述存进 store —— 缺一个都会让 getChatStreamSettings 序列化时

    # 丢字段，导致 /api/chat/stream 收到只剩 {name, enabled_tools:[], add_to_agents} 的残缺配置。

    return {
        "transport": payload.get("transport"),
        "command": payload.get("command"),
        "args": payload.get("args"),
        "url": payload.get("url"),
        "env": payload.get("env"),
        "headers": payload.get("headers"),
        "tools": [
            {
                "name": getattr(tool, "name", type(tool).__name__),
                "description": getattr(tool, "description", ""),
            }
            for tool in tools
        ],

        "prompts": [],


        "resources": [],


    }


class ReportDownloadRequest(BaseModel):
    thread_id: str
    temp_num: int = 0
    checkpoint_id: str = ""


@app.post("/api/graph/report")
async def download_report(request: ReportDownloadRequest):
    """下载研究报告为 Word 文档。
    
    Args:
        thread_id: 会话 ID
        temp_num: 模板编号（0: 无编号, 1: 中文编号, 2: 数字编号）
        checkpoint_id: checkpoint ID（可选）
    """
    if not DOCX_AVAILABLE:
        raise HTTPException(status_code=500, detail="python-docx 未安装，无法导出 Word 文档")
    
    thread_id = request.thread_id
    temp_num = request.temp_num
    checkpoint_id = request.checkpoint_id
    
    # 获取图的当前状态
    safe_config = {
        "configurable": {
            "thread_id": thread_id,
            "checkpoint_ns": "",
        }
    }
    
    try:
        state = await graph.aget_state(safe_config)
        final_report = state.values.get("final_report", "")
        
        if not final_report:
            # 尝试从数据库获取报告
            db = SessionLocal()
            try:
                conversation = repository.get_conversation(db, thread_id)
                if conversation:
                    final_report = conversation.title or ""
            finally:
                db.close()
        
        if not final_report:
            raise HTTPException(status_code=404, detail="未找到报告内容")
        
        # 创建 Word 文档
        doc = Document()
        
        # 设置页面大小为 A4
        section = doc.sections[0]
        section.page_width = Pt(595.28)  # A4 宽度
        section.page_height = Pt(841.89)  # A4 高度
        section.top_margin = Pt(72)
        section.bottom_margin = Pt(72)
        section.left_margin = Pt(72)
        section.right_margin = Pt(72)
        
        # 标题样式
        title_style = doc.styles["Title"]
        title_font = title_style.font
        title_font.name = "微软雅黑"
        title_font.size = Pt(22)
        title_font.bold = True
        title_font.color.rgb = RGBColor(0, 0, 0)
        
        # 一级标题样式
        h1_style = doc.styles["Heading 1"]
        h1_font = h1_style.font
        h1_font.name = "微软雅黑"
        h1_font.size = Pt(16)
        h1_font.bold = True
        h1_font.color.rgb = RGBColor(0, 51, 102)
        
        # 二级标题样式
        h2_style = doc.styles["Heading 2"]
        h2_font = h2_style.font
        h2_font.name = "微软雅黑"
        h2_font.size = Pt(14)
        h2_font.bold = True
        h2_font.color.rgb = RGBColor(0, 51, 102)
        
        # 正文样式
        body_style = doc.styles["Normal"]
        body_font = body_style.font
        body_font.name = "微软雅黑"
        body_font.size = Pt(12)
        
        # 根据模板编号设置标题编号格式
        if temp_num == 1:
            # 中文编号：一、（一）1.（1）
            h1_style.numbering_format = "一、"
            h2_style.numbering_format = "（一）"
        elif temp_num == 2:
            # 数字编号：1. 1.1. 1.1.1.
            h1_style.numbering_format = "1."
            h2_style.numbering_format = "1.1."
        
        # 解析 Markdown 内容并添加到文档
        lines = final_report.split("\n")
        for line in lines:
            line = line.strip()
            
            if line.startswith("# "):
                # 一级标题
                doc.add_heading(line[2:], level=1)
            elif line.startswith("## "):
                # 二级标题
                doc.add_heading(line[3:], level=2)
            elif line.startswith("### "):
                # 三级标题
                doc.add_heading(line[4:], level=3)
            elif line.startswith("**") and line.endswith("**"):
                # 粗体文本
                para = doc.add_paragraph()
                run = para.add_run(line[2:-2])
                run.bold = True
            elif line.startswith("- ") or line.startswith("* "):
                # 列表项
                doc.add_paragraph(line[2:], style="List Bullet")
            elif line.startswith("1. ") or line.startswith("2. ") or line.startswith("3. "):
                # 有序列表
                doc.add_paragraph(line[3:], style="List Number")
            elif line:
                # 普通段落
                doc.add_paragraph(line)
        
        # 保存到字节流
        import io
        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        
        from fastapi.responses import Response
        return Response(
            content=buffer.read(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename=research-report-{thread_id}.docx"},
        )
    
    except Exception as e:
        logger.error(f"[download_report] 下载报告失败: {e}")
        raise HTTPException(status_code=500, detail=f"下载报告失败: {str(e)}")
