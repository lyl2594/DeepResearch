"""第5章节点：HITL（人机协作）三类 interrupt + 计划内联编辑 + handoff 意图分流。

第5章在第4章 ReAct 基础上加人机协作：
- coordinator：用 handoff_to_planner 伪工具判断意图（闲聊不进研究）
- planner → human_feedback：plan_review interrupt（用户审核/编辑计划）
- reporter → report_review：llm_output_review interrupt（用户确认报告）
- retriever_review：节点齐全（human_retriever_node），开关门控，默认不连入主流程（本章 RAG 增量启用）
- interrupt 必须配 checkpointer（builder.py 加 MemorySaver + thread_id）

参考 deepResearch 的 src/graph/nodes.py（coordinator handoff / human_feedback / human_retriever / llm_output_review）。
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from langchain_core.tools import tool
from langgraph.types import Command, interrupt
from langgraph.errors import GraphRecursionError

from agents.agents import create_agent
from config.configuration import Configuration, get_recursion_limit
from config.activities import ActivityType
from graph.commons import clean_think, get_current_step
from graph.types import State
from llm import get_llm_by_type, get_llm_token_limit, get_report_llm
from prompts.planner_model import (
    EvaluationRecord,
    EvaluationResponse,
    Plan,
    PlanMinimal,
    StepType,
)
from prompts.template import apply_prompt_template
from tools.crawl import crawl_tool
from tools.python_repl import python_repl_tool
from tools.search import get_web_search_tool
from database import repository
from database.base import SessionLocal
from server.thread_state_manager import thread_state_manager
from utils.context_manager import ContextManager, validate_message_content
from utils.timing import timed_node
from utils.json_utils import repair_json_output

logger = logging.getLogger(__name__)


def _get_param_value(state: State, name: str, default=None):

    for item in state.get("param_list", []) or []:

        if item.get("name") == name:
            return item.get("value", default)
    return default


def _get_effective_retriever_similarity(state: State, config: Configuration) -> float:
    """返回本轮实际使用的阈值：人工修改 > 知识库配置 > 全局默认。"""
    retry_similarity = _get_param_value(state, "human_retriever_similarity", None)
    if retry_similarity is not None:
        try:
            return float(retry_similarity)
        except (TypeError, ValueError):
            pass

    for rag_config in config.rag_configs or []:

        if rag_config.get("platform") == "aihub":
            try:
                return float(rag_config.get("similarity", config.retriever_similarity))
            except (TypeError, ValueError):
                break
    return config.retriever_similarity


# ============ handoff 伪工具（LLM 意图信号）============

@tool
def handoff_to_planner(
    research_topic: Annotated[str, "研究主题，一句话概括"],
    locale: Annotated[str, "用户语言，如 zh-CN / en-US"],
):
    """Handoff to planner agent to do plan.
    伪工具：本身不做事，只作为 LLM 表达"这是研究需求，交给 planner"的信号。
    coordinator 据 tool_calls 是否存在判断意图（研究 vs 闲聊）。
    """
    return


# ============ coordinator（handoff 意图分流）============

async def coordinator_node(state: State, config) -> Command:
    """协调器：bind_tools([handoff_to_planner])，按 LLM 是否调用工具分流意图。

    - 有 tool_call（研究）→ 提取 topic/locale，goto planner
    - 无 tool_call（闲聊）→ 直接回复，goto __end__（final_report = 回复）
    """
    logger.info("[coordinator] 分析用户输入（handoff 模式）")
    messages = apply_prompt_template("coordinator", state)
    response = await get_llm_by_type("basic").bind_tools([handoff_to_planner]).ainvoke(messages)


    msgs = list(state.get("messages", []))


    if response.tool_calls:
        # 研究意图：从 tool_call 参数提取 topic/locale
        locale = state.get("locale", "zh-CN")
        research_topic = state.get("research_topic", "")
        for tc in response.tool_calls:
            if tc.get("name") == "handoff_to_planner":
                args = tc.get("args", {}) or {}
                research_topic = args.get("research_topic") or research_topic
                locale = args.get("locale") or locale
                break
        logger.info(f"[coordinator] 研究意图：主题={research_topic!r}, 语言={locale!r}")
        if response.content:
            msgs.append(HumanMessage(content=clean_think(response.content), name="coordinator"))
        return Command(
            update={"research_topic": research_topic, "locale": locale, "messages": msgs},
            goto="planner",
        )
    else:
        # 闲聊：直接回复，结束流程
        reply = clean_think(response.content) if response.content else "（未识别意图，请明确你的研究需求）"
        logger.info(f"[coordinator] 闲聊，直接回复并结束。回复: {reply[:50]!r}")
        msgs.append(HumanMessage(content=reply, name="coordinator"))
        return Command(update={"final_report": reply, "messages": msgs}, goto="__end__")


# ============ planner（goto human_feedback 做计划审核）============

async def planner_node(state: State, config) -> Command:
    """规划器：拆多步计划，交给 human_feedback 做计划审核（而非直接 research_team）。"""
    configurable = Configuration.from_config(config)
    plan_iterations = state.get("plan_iterations", 0)

    if plan_iterations >= configurable.max_plan_iterations and plan_iterations > 0:
        logger.info(f"[planner] 达到规划上限({configurable.max_plan_iterations})，直接生成报告")
        return Command(goto="reporter")

    plan_state = {**state, "max_step_num": configurable.max_step_num}
    messages = apply_prompt_template("planner", plan_state)

    llm = get_llm_by_type("basic").with_structured_output(PlanMinimal, method="json_schema")
    response = await llm.ainvoke(messages)

    full_response = response.model_dump_json(indent=4, exclude_none=True)
    full_response = clean_think(full_response)

    try:
        curr_plan_dict = json.loads(repair_json_output(full_response))
    except json.JSONDecodeError as e:
        logger.warning(f"[planner] JSON 解析失败: {e}")
        return Command(goto="reporter" if plan_iterations > 0 else "__end__")

    try:
        curr_plan = Plan.model_validate(curr_plan_dict)
    except Exception as e:
        logger.warning(f"[planner] Plan 校验失败: {e}")
        return Command(goto="reporter" if plan_iterations > 0 else "__end__")

    logger.info(f"[planner] 规划完成：{curr_plan.title}（共 {len(curr_plan.steps)} 步）")
    for i, step in enumerate(curr_plan.steps, 1):
        logger.info(f"  步骤{i} [{step.step_type.value}]: {step.title} — {step.description[:40]}")

    # 第5章：计划交给 human_feedback 审核（不再直接 research_team）
    return Command(
        update={
            "current_plan": curr_plan,
            "plan_iterations": plan_iterations + 1,
            "locale": curr_plan.locale,
        },
        goto="human_feedback",
    )


# ============ 计划内联编辑合并 ============

def _merge_plan_edits(original_plan: dict, edited_plan: dict) -> dict:
    """合并用户编辑的计划到原始计划（长度校验，防御性）。

    参考 deepResearch src/graph/nodes.py:_merge_plan_edits。
    """
    if not edited_plan:
        return original_plan

    original_plan["title"] = edited_plan.get("title") or original_plan.get("title", "")
    original_plan["thought"] = edited_plan.get("thought") or original_plan.get("thought", "")


    original_steps = original_plan.get("steps", [])


    edited_steps = edited_plan.get("steps", [])

    # 只有步骤数一致才逐条合并，避免错位
    if edited_steps and len(original_steps) == len(edited_steps):
        for orig, edited in zip(original_steps, edited_steps):
            orig.update(edited)

    return original_plan


# ============ human_feedback（plan_review interrupt）============

async def human_feedback_node(state: State, config) -> Command:
    """计划审核 HITL：interrupt 让用户审核/编辑计划。

    协议：
      [ACCEPTED] → research_team（接受计划，开始研究）
      [EDIT_PLAN] → planner（回规划器重新规划；若 state.edited_plan 有值则合并）
    auto_accepted_plan=True 时跳过 interrupt（CLI 一键模式）。
    """
    current_plan = state.get("current_plan")
    auto_accepted = state.get("auto_accepted_plan", False)
    edited_plan = state.get("edited_plan")

    if not auto_accepted:
        # interrupt：暂停图，等外部 Command(resume=feedback) 恢复
        feedback = interrupt(
            {
                "type": "plan_review",
                "message": "请审核研究计划（[ACCEPTED] 接受 / [EDIT_PLAN] 重新规划）",
                "content": str(current_plan),
            }
        )
        logger.info(f"[human_feedback] 收到计划审核反馈: {feedback!r}")

        fb_upper = str(feedback).upper() if feedback else ""
        if fb_upper.startswith("[EDIT_PLAN]"):
            return Command(
                update={"messages": [HumanMessage(content=str(feedback), name="feedback")]},
                goto="planner",
            )
        elif fb_upper.startswith("[ACCEPTED]"):
            logger.info("[human_feedback] 计划被接受")
        else:
            # 其他输入默认视为接受（CLI 友好）
            logger.info(f"[human_feedback] 反馈 {feedback!r} 视为接受")

    # 解析计划并合并编辑
    plan_iterations = state.get("plan_iterations", 0)
    try:
        if isinstance(current_plan, Plan):
            plan_dict = current_plan.model_dump()
        else:
            plan_dict = json.loads(repair_json_output(str(current_plan)))
        if edited_plan:
            plan_dict = _merge_plan_edits(plan_dict, edited_plan)
        new_plan = Plan.model_validate(plan_dict)
    except Exception as e:
        logger.warning(f"[human_feedback] 计划解析失败: {e}")
        return Command(goto="reporter" if plan_iterations > 1 else "__end__")

    return Command(
        update={
            "current_plan": new_plan,
            "plan_iterations": plan_iterations,
            "locale": new_plan.locale,
        },
        goto="research_team",
    )


async def human_retriever_node(state: State, config) -> Command:
    """审核本轮知识库检索结果；接受后提交缓存结果，修改后重新研究。"""
    current_plan = state.get("current_plan")
    current_step = get_current_step(current_plan)
    review_data = state.get("pending_retrieval_review") or {}
    feedback = interrupt(
        {
            "type": "retriever_review",
            "message": (
                "请审核知识库检索结果；可接受并继续，或修改关键词/阈值后重新检索。"
            ),
            "re_execute_times": getattr(current_step, "step_iterations", 0),
            "review_data": review_data,
        }
    )
    logger.info(f"[human_retriever] 收到检索审核反馈: {feedback!r}")
    if feedback and str(feedback).upper().startswith("[CONTINUE]"):
        pending_result = state.get("pending_execution_res") or ""

        documents = review_data.get("documents") or [ ]

        if not documents:
            return Command(
                update={
                    "messages": [HumanMessage(content=str(feedback), name="feedback")],
                    "pending_retrieval_review": None,

                    "param_list": [],

                },
                goto="human_direct_output",
            )
        if current_step is not None:
            current_step.execution_res = pending_result or "（用户接受空检索结果）"
        return Command(
            update={
                "messages": [HumanMessage(content=str(feedback), name="feedback")],
                "current_plan": current_plan,

                "observations": [pending_result] if pending_result else [],

                "pending_retrieval_review": None,
                "pending_execution_res": None,

                "param_list": [],

            },
            goto="research_team",
        )
    return Command(
        update={
            "pending_retrieval_review": None,
            "pending_execution_res": None,
        },
        goto="researcher",
    )


async def human_direct_output_node(state: State, config) -> Command:
    """无背景资料审核：确认是否保留模型直接回答。

    业务语义对齐原项目 llm_output_review / direct_output，
    但使用本章已有的 pending_execution_res，避免 resume 时重复执行 agent。
    """
    current_plan = state.get("current_plan")
    current_step = get_current_step(current_plan)
    feedback = interrupt(
        {
            "type": "llm_output_review",
            "message": "当前没有检索到背景知识，是否保留模型直接回答？",
            "re_execute_times": getattr(current_step, "step_iterations", 0),
        }
    )
    direct_output = str(
        _get_param_value(state, "direct_output", "false")
    ).lower() == "true"
    pending_result = state.get("pending_execution_res") or ""
    execution_result = (
        pending_result if direct_output else "Empty research result."
    )
    if current_step is not None:
        current_step.execution_res = execution_result
    logger.info(
        f"[human_direct_output] 用户选择 direct_output={direct_output}: {feedback!r}"
    )
    return Command(
        update={
            "messages": [HumanMessage(content=str(feedback), name="feedback")],
            "current_plan": current_plan,
            "observations": [execution_result],
            "pending_execution_res": None,
            "pending_retrieval_review": None,

            "param_list": [],

        },
        goto="research_team",
    )


# ============ research_team（空枢纽）============

async def research_team_node(state: State) -> dict:
    current_plan = state.get("current_plan")

    steps = getattr(current_plan, "steps", []) or [ ]

    done = sum(1 for s in steps if s.execution_res)
    logger.info(f"[research_team] 调度研究团队（进度 {done}/{len(steps)}）")
    return {}


# ============ pre_model_hook：token 观察器（沿用第4章）============

def make_context_manager_hook(agent_name: str, preserve: int = 3):
    """创建上下文管理 pre_model_hook：超限压缩 + 7 重校验（第7章升级，替换第4章 token 观察器）。

    第4章的 pre_model_hook 只观察 token；第7章实际压缩：
    - validate_message_content 7 重校验（防 None/list/dict content 崩溃）
    - ContextManager.compress_messages 超限时滑动窗口压缩（保前缀 + 尾部回填 + 截断）
    未配 token_limit 时退化为观察器（不压缩，仅记录）。
    作为 create_react_agent 的 pre_model_hook，每次 LLM 调用前触发。
    """
    token_limit = get_llm_token_limit("basic")
    if not token_limit:
        logger.warning(
            f"[context_manager/{agent_name}] 未配 token_limit，上下文压缩失效（仅观察）"
        )
        return _make_observer_only_hook(agent_name)

    cm = ContextManager(token_limit, preserve)

    def hook(state):

        messages = state.get("messages", [])

        before = cm.count_tokens(messages)
        # 7 重校验（防 None / list / dict content 把 LLM 调用搞崩）
        messages = validate_message_content(messages)
        # 超限压缩
        new_messages = cm.compress_messages({"messages": messages})["messages"]
        after = cm.count_tokens(new_messages)
        if before != after:
            logger.info(
                f"[context_manager/{agent_name}] 压缩: {before} -> {after} tokens "
                f"(limit={token_limit}, 消息 {len(messages)}->{len(new_messages)})"
            )
        else:
            logger.info(
                f"[context_manager/{agent_name}] {after} tokens / {len(new_messages)} 条 "
                f"(limit={token_limit}, 未超限)"
            )
        return {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), *new_messages]}

    return hook


def _make_observer_only_hook(agent_name: str):
    """token 观察器（无 token_limit 时的退化 hook，只记录不压缩）。"""

    def hook(state):

        messages = state.get("messages", [])

        total_chars = sum(len(str(getattr(m, "content", ""))) for m in messages)
        logger.info(
            f"[observer/{agent_name}] 消息数={len(messages)}, 估算token≈{int(total_chars / 2.5)}"
        )
        return {}

    return hook


# ============ ReAct 执行（researcher / coder，沿用第4章）============

def _log_node_event(thread_id: str, node: str, payload: dict, level: str = "info") -> None:
    """记录节点事件到业务表（业务可观测，第9章）。无 thread_id 或落库失败则跳过。"""
    if not thread_id:
        return
    db = None
    try:
        db = SessionLocal()
        repository.log_graph_event(db, thread_id, node, payload, level)
    except Exception as e:
        logger.warning(f"[log_event] 节点事件落库失败（不影响流程）: {e}")
    finally:
        if db is not None:
            db.close()


async def _finish_skipped_retry(
    current_step,
    current_plan,
    configurable: Configuration,
    thread_id: str,
    agent_name: str,
    phase: str,
) -> Command:
    """放弃当前重试，恢复最近一次完整结果，并阻止该步骤再次进入评估。"""
    previous_result = current_step.last_execution_res
    previous_evaluation = current_step.last_evaluation_result
    if not previous_result:
        previous_result = current_step.execution_res or "（用户跳过本轮重试；无可恢复结果）"
    if not previous_evaluation:
        previous_evaluation = {
            "quality_score": 0.0,
            "feedback": "用户跳过后续重试，保留最近一次可用结果。",
            "skipped_retry": True,
        }

    current_step.execution_res = previous_result
    current_step.evaluation_result = previous_evaluation
    current_step.step_iterations = max(
        current_step.step_iterations,
        configurable.max_step_iterations + 1,
    )
    thread_state_manager.set_skip_state(thread_id, False)
    await asyncio.to_thread(
        _log_node_event,
        thread_id,
        agent_name,
        {"action": "skip_retry", "step": current_step.title, "phase": phase},
    )
    logger.info(
        f"[{agent_name}] 已跳过当前重试并保留上次结果: {current_step.title!r}"
    )
    # 上次结果在首次执行完成时已经进入 observations，不重复追加。
    return Command(update={"current_plan": current_plan}, goto="research_team")


async def _execute_agent_step(state, agent, agent_name, config) -> Command:
    """用 ReAct agent 执行当前步骤（流式 astream）。沿用第4章实现。"""
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")

    current_step = get_current_step(current_plan)
    if not current_step:
        return Command(goto="research_team")
    runtime_config = Configuration.from_config(config)

    # 契约对齐主项目 reference-source/deer-flow-aw/src/graph/nodes.py:1020-1029：
    # 首次进入该步骤时，先向 state 写入 step / step_title 再回 research_team。
    # 前端 research-activities-block 按 message.step 分组渲染 activities 卡片，
    # step 空的话所有节点消息都挤在同一桶里，eval 卡片位置错乱、re_execute 计数异常。
    # 用 step_command != state.step 判断"首次"，避免 skip 后回来第二次进入无限刷 step。
    try:
        step_index = current_plan.steps.index(current_step)
        step_command = f"step{step_index}"
    except ValueError:
        step_command = ""
    if step_command and state.get("step", "") != step_command:
        return Command(
            update={
                "step": step_command,
                "step_title": current_step.title,
                "current_plan": current_plan,
            },
            goto="research_team",
        )

    # 第9章：skip 检查（前端 POST /api/chat/skip 设置，跳过当前步但 graph 继续跑下一步）
    configurable = (config or {}).get("configurable", {}) if isinstance(config, dict) else {}
    thread_id = configurable.get("thread_id", "")
    if thread_id and thread_state_manager.get_skip_state(thread_id):
        if current_step.step_iterations >= 1:
            return await _finish_skipped_retry(
                current_step,
                current_plan,
                runtime_config,
                thread_id,
                agent_name,
                phase="before_running",
            )
        # skip 只允许用于低分重试，防止直接调用 API 跳过首次执行。
        thread_state_manager.set_skip_state(thread_id, False)
        logger.warning(f"[{agent_name}] 忽略首次执行阶段的 skip 请求")

    completed_steps = [s for s in current_plan.steps if s.execution_res and s != current_step]
    locale = state.get("locale", "zh-CN")
    logger.info(f"[{agent_name}] ReAct 执行步骤: {current_step.title!r}")

    completed_info = ""
    if completed_steps:
        completed_info = "# 已完成步骤\n\n"
        for i, s in enumerate(completed_steps, 1):
            completed_info += f"## 步骤{i}: {s.title}\n<finding>\n{s.execution_res}\n</finding>\n\n"

    agent_input = {
        "messages": [
            HumanMessage(
                content=(
                    f"# 研究主题\n\n{current_plan.title}\n\n{completed_info}"
                    f"# 当前步骤\n\n## 标题\n{current_step.title}\n\n"
                    f"## 描述\n{current_step.description}\n\n## 语言\n{locale}"
                )
            )
        ]
    }
    # 结构性兜底：工具调用场景 Qwen 默认用英文推理，强制按 locale 语言思考
    agent_input["messages"].append(
        HumanMessage(
            content=(
                f"铁律：全程必须用 {locale} 语言思考与推理（zh-CN=中文）。"
                f"每次调用工具【之前】的思考、计划、分析也必须用 {locale} 语言逐字书写，"
                f"绝对禁止用英文思考。仅工具参数（搜索关键词等）可用英文。"
            ),
            name="system",
        )
    )
    if agent_name == "researcher":
        agent_input["messages"].append(
            HumanMessage(
                content="重要：不要在正文里内联引用，来源集中在末尾「关键引用」，格式 - [标题](URL)。",
                name="system",
            )
        )
        retry_query = _get_param_value(state, "human_retriever_query", "")
        if retry_query:
            agent_input["messages"].append(
                HumanMessage(
                    content=f"用户要求本轮知识库检索优先使用关键词：{retry_query}",
                    name="system",
                )
            )
        previous_feedback = next(
            (
                record.feedback

                for record in reversed(state.get("evaluation_history", []) or [])

                if record.step_title == current_step.title and record.feedback
            ),
            "",
        )
        if current_step.step_iterations > 0 and previous_feedback:
            agent_input["messages"].append(
                HumanMessage(
                    content=f"这是重试执行。请针对上次评估反馈逐项改进：\n{previous_feedback}",
                    name="system",
                )
            )
        if runtime_config.enable_web_search:
            agent_input["messages"].append(
                HumanMessage(
                    content="重要：先用原语言搜索，再翻译成英文搜索一次。禁止编造 URL。",
                    name="system",
                )
            )

    recursion_limit = get_recursion_limit()

    messages = [ ]

    chunk_count = 0
    skip_requested = False
    retrieval_review = None
    has_background_knowledge = False
    recursion_hit = False

    # 兜底策略：ReAct 在单个步骤里疯狂循环时，步数达到 recursion_limit 会抛
    # GraphRecursionError。这里包一层 async 生成器，把“超限”转成“正常结束 + 标记”，
    # 让外层用已经收集到的部分工具结果收尾并继续后续流程，
    # 而不是让整轮研究因单步失控而整体崩掉（单纯调大上限只是治标不治本）。
    async def _iter_agent_chunks():
        nonlocal recursion_hit
        gen = agent.astream(
            agent_input,
            config={"recursion_limit": recursion_limit},
            stream_mode="values",
        )
        try:
            async for chunk in gen:
                yield chunk
        except GraphRecursionError:
            recursion_hit = True
            logger.warning(
                f"[{agent_name}] 达到 ReAct 递归上限 {recursion_limit}，"
                f"采用已收集的部分结果兜底收尾（步骤：{current_step.title!r}）。"
            )
            try:
                await gen.aclose()
            except Exception:
                pass
        except Exception:
            raise

    async for chunk in _iter_agent_chunks():
        chunk_count += 1
        if (
            thread_id
            and current_step.step_iterations >= 1
            and thread_state_manager.get_skip_state(thread_id)
        ):
            skip_requested = True
            break
        if not isinstance(chunk, dict):
            continue

        msgs = chunk.get("messages", [])

        if not msgs:
            continue
        latest = msgs[-1]
        if isinstance(latest, HumanMessage):
            continue
        messages.append(latest)
        if agent_name == "researcher" and isinstance(latest, ToolMessage):
            for earlier in reversed(messages[:-1]):
                matched_call = next(
                    (
                        call

                        for call in getattr(earlier, "tool_calls", []) or [ ]

                        if call.get("id") == latest.tool_call_id
                    ),
                    None,
                )
                if matched_call is None:
                    continue
                if matched_call.get("name") == "local_search_tool":
                    try:
                        documents = (
                            latest.content
                            if isinstance(latest.content, list)
                            else json.loads(latest.content)
                        )
                    except (json.JSONDecodeError, TypeError):

                        documents = [ ]

                    retrieval_review = {
                        "query": (
                            _get_param_value(state, "human_retriever_query", "")
                            or matched_call.get("args", {}).get("keywords", "")
                        ),
                        "similarity": _get_effective_retriever_similarity(
                            state, runtime_config
                        ),

                        "documents": documents if isinstance(documents, list) else [],

                    }
                    has_background_knowledge = (
                        has_background_knowledge
                        or bool(retrieval_review["documents"])
                    )
                else:
                    tool_content = latest.content
                    if isinstance(tool_content, list):
                        has_background_knowledge = (
                            has_background_knowledge or bool(tool_content)
                        )
                    elif tool_content is not None:
                        normalized_content = str(tool_content).strip()
                        has_background_knowledge = (
                            has_background_knowledge

                            or normalized_content not in ("", "[]")

                        )
                break
    if skip_requested:
        return await _finish_skipped_retry(
            current_step,
            current_plan,
            runtime_config,
            thread_id,
            agent_name,
            phase="running",
        )
    logger.info(
        f"[{agent_name}] astream 结束：{chunk_count} 个 chunk，累积 {len(messages)} 条非 Human 消息"
    )

    # 提取最终回复（层层兜底）
    response_content = ""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content and not getattr(msg, "tool_calls", None):
            response_content = msg.content
            break
    if not response_content:
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and msg.content:
                response_content = msg.content
                break
    response_content = clean_think(response_content)
    if not response_content.strip():
        for msg in reversed(messages):
            content = getattr(msg, "content", "")
            if content and not isinstance(msg, HumanMessage):
                response_content = str(content)
                logger.warning(f"[{agent_name}] 最终回复为空，用最后一条工具结果兜底")
                break
    if not response_content.strip():
        if recursion_hit:
            response_content = f"（{agent_name} 已在单步内达到工具调用/推理上限，此处为阶段产出，后续步骤会继续深入）"
        else:
            response_content = f"（{agent_name} 未产出有效结果）"

    if retrieval_review is not None:
        return Command(
            update={
                "current_plan": current_plan,
                "pending_retrieval_review": retrieval_review,
                "pending_execution_res": response_content,
            },
            goto="human_retriever",
        )

    if agent_name == "researcher" and not has_background_knowledge:
        return Command(
            update={
                "current_plan": current_plan,
                "pending_execution_res": response_content,
            },
            goto="human_direct_output",
        )

    current_step.execution_res = response_content
    logger.info(f"[{agent_name}] 步骤完成: {current_step.title!r}（结果 {len(response_content)} 字）")
    await asyncio.to_thread(
        _log_node_event,
        thread_id, agent_name,
        {"action": "execute", "step": current_step.title, "result_len": len(response_content)},
    )
    return Command(
        update={"current_plan": current_plan, "observations": [response_content]},
        goto="research_team",
    )


async def _setup_and_execute_agent_step(state, config, agent_type, default_tools) -> Command:
    # 本章 MCP 增量：动态工具加载（配置 mcp_settings 且该 agent 在 add_to_agents 时）
    tools = list(default_tools)  # 浅拷贝，防污染默认工具列表
    configurable = Configuration.from_config(config)
    mcp_settings = configurable.mcp_settings if configurable else None
    if mcp_settings and isinstance(mcp_settings, dict) and mcp_settings.get("servers"):
        enabled_servers = {}
        for name, sc in mcp_settings["servers"].items():

            if sc.get("enabled_tools") and agent_type in sc.get("add_to_agents", []):

                enabled_servers[name] = {
                    k: v for k, v in sc.items()
                    if k in ("transport", "command", "args", "url", "env", "headers")
                }
        if enabled_servers:
            from server.mcp_utils import load_mcp_tools
            mcp_tools = await load_mcp_tools(enabled_servers)
            # 工具来源标注（审计：知道工具来自哪个 MCP server）
            for t in mcp_tools:
                src = next(
                    (n for n, s in enabled_servers.items()

                     if t.name in s.get("enabled_tools", [])),

                    "mcp",
                )
                t.description = f"Powered by '{src}'.\n{t.description}"
            tools.extend(mcp_tools)
            logger.info(f"[{agent_type}] 已加载 {len(mcp_tools)} 个 MCP 工具")

    pre_model_hook = make_context_manager_hook(agent_type)
    tool_names = {getattr(tool, "name", "") for tool in tools}
    agent = create_agent(
        agent_type,
        agent_type,
        tools,
        agent_type,
        pre_model_hook,
        prompt_context={
            "enable_web_search": configurable.enable_web_search,
            "enable_rag": configurable.enable_rag,
            "has_local_search": "local_search_tool" in tool_names,
        },
    )
    return await _execute_agent_step(state, agent, agent_type, config)


@timed_node
async def researcher_node(state: State, config) -> Command:
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")
    if not get_current_step(current_plan):
        return Command(goto="research_team")
    configurable = Configuration.from_config(config)

    tools = [ ]

    if configurable.enable_web_search:
        tools.extend(
            [get_web_search_tool(max_results=configurable.max_search_results), crawl_tool]
        )
    # 本章 RAG 增量：配置 resources 时加 local_search_tool（RAG-web 协同）
    if configurable.enable_rag and (configurable.resources or configurable.rag_configs):
        logger.info(
            f"[researcher] 尝试加载 RAG 工具: enable_rag={configurable.enable_rag}, "
            f"resources_len={len(configurable.resources or [])}, "
            f"rag_configs_len={len(configurable.rag_configs or [])}"
        )
        from rag.builder import build_retriever_by_configs
        from tools.retriever import make_local_search_tool
        retry_similarity = _get_param_value(
            state, "human_retriever_similarity", None
        )
        retrievers = build_retriever_by_configs(
            configurable.resources,
            enabled_configs=configurable.rag_configs,
            similarity=float(
                retry_similarity
                if retry_similarity is not None
                else configurable.retriever_similarity
            ),
            retriever_keyword=str(
                _get_param_value(state, "human_retriever_query", "")
            ),
            override_similarity=retry_similarity is not None,
        )
        logger.info(f"[researcher] build_retriever_by_configs 返回 {len(retrievers)} 个 retrievers")
        if retrievers:
            try:
                resources = [
                    resource
                    for retriever in retrievers
                    for resource in retriever.list_resources()
                ]
                logger.info(f"[researcher] 从 retrievers 获取到 {len(resources)} 个资源")
                tools.append(make_local_search_tool(retrievers, resources))
                logger.info(
                    f"[researcher] 已加载 local_search_tool（实际资源数={len(resources)}, "
                    f"前端传入resources={len(configurable.resources or [])}, "
                    f"rag_configs={len(configurable.rag_configs or [])}）"
                )
            except Exception as e:
                logger.error(
                    f"[researcher] 加载 RAG 工具失败: {e}，跳过 RAG 检索", exc_info=True
                )
        else:
            logger.warning("[researcher] build_retriever_by_configs 返回空列表，未加载 RAG 工具")
    else:
        logger.info(
            f"[researcher] 跳过加载 RAG 工具: enable_rag={configurable.enable_rag}, "
            f"resources={bool(configurable.resources)}, "
            f"rag_configs={bool(configurable.rag_configs)}"
        )
    return await _setup_and_execute_agent_step(state, config, "researcher", tools)


@timed_node
async def coder_node(state: State, config) -> Command:
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")
    if not get_current_step(current_plan):
        return Command(goto="research_team")
    return await _setup_and_execute_agent_step(state, config, "coder", [python_repl_tool])


# ============ reporter（生成报告）============

@timed_node
async def reporter_node(state: State, config) -> dict:
    """报告员：综合每个步骤最终保留的结果生成 markdown 报告。"""
    locale = state.get("locale", "zh-CN")
    current_plan = state.get("current_plan")
    observations = (
        [step.execution_res for step in current_plan.steps if step.execution_res]
        if isinstance(current_plan, Plan)

        else state.get("observations", [])

    )
    logger.info(f"[reporter] 撰写报告，共 {len(observations)} 条观察")

    obs_text = "\n\n---\n\n".join(
        f"【观察 {i + 1}】\n{o}" for i, o in enumerate(observations)
    )
    input_state = {
        "locale": locale,
        "messages": [HumanMessage(content=f"# 研究观察资料\n\n{obs_text}")],
    }
    messages = apply_prompt_template("reporter", input_state)
    report_style = Configuration.from_config(config).report_style
    if report_style:
        messages.append(
            HumanMessage(
                content=f"请使用用户选择的报告风格撰写：{report_style}",
                name="system",
            )
        )
    response = await get_report_llm().ainvoke(messages)
    report = clean_think(response.content)
    logger.info("[reporter] 报告生成完成")
    return {"final_report": report}


# ============ report_review（最终报告审核 interrupt）============

async def report_review_node(state: State, config) -> Command:
    """报告审核 HITL：interrupt 让用户确认报告。

    协议：
      [ACCEPTED] → final_report_evaluator（进入终评）
      [CONTINUE] → reporter（重新生成）
    auto_accepted_plan=True 时跳过（--auto 模式，直接进终评）。
    """
    if state.get("auto_accepted_plan", False):
        return Command(goto="final_report_evaluator")
    feedback = interrupt(
        {
            "type": "report_review",
            "message": "报告已生成，请确认（[ACCEPTED] 接受 / [CONTINUE] 重新生成）",
        }
    )
    logger.info(f"[report_review] 收到报告审核反馈: {feedback!r}")
    if feedback and str(feedback).upper().startswith("[CONTINUE]"):
        return Command(goto="reporter")
    # [ACCEPTED] 或默认 → 进入终评
    return Command(goto="final_report_evaluator")


# ============ eval（步骤评分，第6章新增）============

async def eval_node(state: State, config) -> Command:
    """评估节点：找最近完成但未评估的 RESEARCH step，打分。

    低分重做由 continue_to_running_research_team 路由驱动（非本节点）。
    注意 step_iterations 在 eval 递增（不是 researcher），防止"研究→评估"循环无限。
    """
    # 直接沿用原项目的 custom stream：评估模型工作期间，前端先看到“评估研究结果”。
    writer = get_stream_writer()
    writer(
        (
            AIMessage(
                content=ActivityType.EVALUATE_RESEARCH.description,
                additional_kwargs={
                    "activity": {
                        "activity_type": ActivityType.EVALUATE_RESEARCH.type,
                        "activity_name": ActivityType.EVALUATE_RESEARCH.description,
                    }
                },
                id="run--" + uuid4().hex,
            ),
            (config or {}).get("metadata", {}),
        )
    )

    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")

    target = None
    for step in current_plan.steps:
        if (
            step.execution_res
            and step.step_type == StepType.RESEARCH
            and not step.evaluation_result
        ):
            target = step
            break

    if not target:
        logger.info("[eval] 无待评估的研究步骤")
        return Command(goto="research_team")

    logger.info(f"[eval] 评估步骤: {target.title!r}")
    configurable = Configuration.from_config(config)
    result = await _evaluate_research_step(target, state)
    retry_count = target.step_iterations
    target.step_iterations += 1  # 重做计数在 eval 递增（不是 researcher）

    score = result.get("quality_score", 0.0)
    feedback = result.get("feedback", "")
    logger.info(f"[eval] 步骤 {target.title!r} 评分 {score:.2f}：{feedback[:60]}")

    # 低分且未超重做上限 → 清空结果，待 researcher 重做；否则保留评估结果
    if (
        score < configurable.min_quality_score
        and target.step_iterations <= configurable.max_step_iterations
    ):
        logger.info(
            f"[eval] 低分 {score:.2f} < {configurable.min_quality_score}，"
            f"清空结果待重做（第 {target.step_iterations} 次）"
        )
        # 重试前保存最近一次完整结果；用户点击“跳过执行”时恢复该快照，
        # 表示放弃继续优化而不是把“已跳过”当作新结果再次评估。
        target.last_execution_res = target.execution_res
        target.last_evaluation_result = result
        target.execution_res = None
        target.evaluation_result = None
    else:
        target.evaluation_result = result
        target.last_execution_res = None
        target.last_evaluation_result = None
        if score < configurable.min_quality_score:
            logger.info(
                f"[eval] 低分但已达重做上限({target.step_iterations}>{configurable.max_step_iterations})，保留结果"
            )

    record = EvaluationRecord(
        step_title=target.title,
        step_type=target.step_type.value,
        quality_score=score,
        feedback=feedback,
        evaluator_name="evaluator",
    )
    evaluation_message = AIMessage(
        content="研究步骤评估结果",
        name="evaluator",
        additional_kwargs={
            "event_type": "evaluation",
            "evaluation_data": {
                "step_id": f"step_{hash(target.title)}",
                "step_title": target.title,
                "step_type": target.step_type.value,
                "quality_score": score,
                "feedback": feedback,
                "evaluation_timestamp": record.evaluation_timestamp.isoformat(),
                "evaluator_name": "evaluator",
                "evaluation_status": "completed",
            },
            # 首次执行为 0；第一次重试期间为 1。调度计数在上方另行递增。
            "re_execute_times": retry_count,
        },
    )
    evaluation_message.response_metadata = {"finish_reason": "stop"}
    return Command(
        update={
            "messages": [evaluation_message],
            "current_plan": current_plan,
            "evaluation_history": [record],
        },
        goto="research_team",
    )


async def _evaluate_research_step(step, state) -> dict:
    """评估单个研究步骤质量（structured_output + 3 次重试 + clamp [0,1]）。

    参考 deepResearch src/graph/nodes.py:_evaluate_research_step。
    """
    prompt = f"""请评估以下研究步骤的执行质量：

研究主题: {state.get("research_topic", "未知")}
步骤标题: {step.title}
步骤描述: {step.description}
执行结果: {step.execution_res}

评估维度：内容完整性、信息准确性、来源可靠性、相关性、深度与广度。
请返回总体质量评分 (0-1) 和简洁的改进建议（中文，最多 3 条）。

要求：
- 直接返回 JSON，不要返回无关内容
- quality_score 必须是 0~1 之间的小数（如 0.7），不要用百分制
- 返回格式：{{"quality_score": 0.7, "feedback": "1. 改进建议一 2. 改进建议二"}}
"""
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            llm = get_llm_by_type("basic").with_structured_output(
                EvaluationResponse, method="json_schema"
            )
            resp = await llm.ainvoke([HumanMessage(content=prompt)])
            data = json.loads(repair_json_output(resp.model_dump_json(exclude_none=True)))
            score = float(data.get("quality_score", 0.01))
            if score > 1.0:
                score = score / 100.0  # LLM 返回百分制（如 80）时归一化到 0-1
            return {
                "quality_score": min(max(score, 0.0), 1.0),  # clamp 兜底越界
                "feedback": data.get("feedback", "无具体反馈"),
            }
        except Exception as e:
            logger.error(f"[eval] 评估第 {attempt}/{max_retries} 次失败: {e}")
    return {"quality_score": 0.0, "feedback": "评估过程出错"}


# ============ final_report_evaluator（终评 + reflection loop，第6章新增）============

async def final_report_evaluator_node(state: State, config) -> Command:
    """终评节点：评估最终报告质量。

    reflection loop：评分低于 min_quality_score 且 plan_iterations < max_plan_iterations
    → 回 planner 重新规划（评估驱动重规划）；否则 → __end__。
    """
    final_report = state.get("final_report", "")
    if not final_report:
        logger.warning("[final_eval] 无报告可评估，结束")
        return Command(goto="__end__")

    logger.info("[final_eval] 评估最终报告")
    result = await _evaluate_final_report(final_report, state)
    score = result.get("quality_score", 0.0)
    feedback = result.get("feedback", "")
    logger.info(f"[final_eval] 报告评分 {score:.2f}：{feedback[:80]}")

    record = EvaluationRecord(
        step_title="最终报告",
        step_type="final_report",
        quality_score=score,
        feedback=feedback,
        evaluator_name="final_evaluator",
    )

    # 构造 evaluation_data 塞进 AIMessage.additional_kwargs（对齐主项目 deer-flow-aw 做法）：
    # 让 messages 流自然吐出这条 AIMessage，server 侧 _process_message_chunk 识别
    # agent_name == "final_report_evaluator" 后从 additional_kwargs 提取 evaluation_data，
    # 推 event: evaluation 给前端。数据源单点在节点，server 只做转发。
    evaluation_message = AIMessage(
        content="最终报告评估结果",
        name="final_report_evaluator",
        additional_kwargs={
            "event_type": "final_report_evaluation",
            "evaluation_data": {
                "step_id": "final_report",
                "step_title": "最终报告",
                "step_type": "final_report",
                "quality_score": score,
                "feedback": feedback,
                "evaluation_timestamp": record.evaluation_timestamp.isoformat(),
                "evaluator_name": "final_evaluator",
                "evaluation_status": "completed",
            },
        },
    )
    # finish_reason=stop 触发前端 store 里 isStreaming=false + 数据持久化
    evaluation_message.response_metadata = {"finish_reason": "stop"}

    update = {
        "messages": [evaluation_message],
        "evaluation_history": [record],
        "final_report_evaluation": {"quality_score": score, "feedback": feedback},
    }

    configurable = Configuration.from_config(config)
    plan_iterations = state.get("plan_iterations", 0)
    if score < configurable.min_quality_score and plan_iterations < configurable.max_plan_iterations:
        logger.info(
            f"[final_eval] 报告评分 {score:.2f} < {configurable.min_quality_score}，"
            f"回 planner 重新规划（reflection loop）"
        )
        return Command(update=update, goto="planner")

    return Command(update=update, goto="__end__")


async def _evaluate_final_report(report: str, state) -> dict:
    """评估最终报告（structured_output + 重试）。"""
    prompt = f"""请评估以下研究报告的质量：

研究主题: {state.get("research_topic", "未知")}
报告内容:
{report[:3000]}

评估维度：结构完整性、内容准确性、引用可靠性、分析深度、可读性。
请返回总体质量评分 (0-1) 和改进建议（中文）。

要求：
- 直接返回 JSON，不要返回无关内容
- quality_score 必须是 0~1 之间的小数（如 0.85），不要用百分制
- 返回格式：{{"quality_score": 0.85, "feedback": "优点与改进建议"}}
"""
    for attempt in range(1, 4):
        try:
            llm = get_llm_by_type("basic").with_structured_output(
                EvaluationResponse, method="json_schema"
            )
            resp = await llm.ainvoke([HumanMessage(content=prompt)])
            data = json.loads(repair_json_output(resp.model_dump_json(exclude_none=True)))
            score = float(data.get("quality_score", 0.01))
            if score > 1.0:
                score = score / 100.0  # LLM 返回百分制时归一化到 0-1
            return {
                "quality_score": min(max(score, 0.0), 1.0),  # clamp 兜底越界
                "feedback": data.get("feedback", "无具体反馈"),
            }
        except Exception as e:
            logger.error(f"[eval] 评估第 {attempt}/{max_retries} 次失败: {e}")
    return {"quality_score": 0.0, "feedback": "评估过程出错"}