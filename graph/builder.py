"""图构建：评估闭环（步骤评分 + 终评 + reflection loop）。

第6章拓扑（在第5章 HITL 基础上加评估）：
    START → coordinator →(Command)→ planner →(Command)→ human_feedback
    human_feedback →(Command)→ research_team
    research_team →(条件边)→ researcher / coder / eval / reporter
    researcher / coder / eval →(Command)→ research_team
    reporter → report_review →(Command)→ final_report_evaluator / reporter
    final_report_evaluator →(Command)→ __end__ / planner（reflection loop）

continue_to_running_research_team 路由（评估驱动，状态机式）：
    - 有「已完成但未评估」的 RESEARCH step → eval
    - 有未完成 step（execution_res 空，含被 eval 清空的低分重做）→ researcher/coder
    - 全完成 → reporter
final_report_evaluator：报告低分 + plan_iterations < max → planner 重新规划（reflection loop）。
"""
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import START, StateGraph

from config.configuration import Configuration
from graph.nodes import (
    coder_node,
    coordinator_node,
    eval_node,
    final_report_evaluator_node,
    human_feedback_node,
    human_direct_output_node,
    human_retriever_node,
    planner_node,
    report_review_node,
    reporter_node,
    research_team_node,
    researcher_node,
)
from graph.types import State
from prompts.planner_model import Plan, StepType


def continue_to_running_research_team(state, config) -> str:
    """research_team 条件路由：评估驱动（状态机式，不直接改 state）。

    低分重做由 eval_node 清空 execution_res 实现，本函数只读状态。
    """
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return "reporter"

    # 1. 有「已完成但未评估」的 RESEARCH step → eval
    for step in current_plan.steps:
        if (
            step.execution_res
            and step.step_type == StepType.RESEARCH
            and not step.evaluation_result
        ):
            return "eval"

    # 2. 有未完成 step（execution_res 空）→ 按 step_type 分流
    for step in current_plan.steps:
        if not step.execution_res:
            if step.step_type == StepType.PROCESSING:
                return "coder"
            return "researcher"

    # 3. 全完成 → reporter
    return "reporter"


def build_graph():
    builder = StateGraph(State)

    builder.add_node("coordinator", coordinator_node)
    builder.add_node("planner", planner_node)
    builder.add_node("human_feedback", human_feedback_node)
    builder.add_node("human_retriever", human_retriever_node)
    builder.add_node("human_direct_output", human_direct_output_node)
    builder.add_node("research_team", research_team_node)
    builder.add_node("researcher", researcher_node)
    builder.add_node("coder", coder_node)
    builder.add_node("eval", eval_node)                          # 第6章新增
    builder.add_node("reporter", reporter_node)
    builder.add_node("report_review", report_review_node)
    builder.add_node("final_report_evaluator", final_report_evaluator_node)  # 第6章新增

    builder.add_edge(START, "coordinator")
    # coordinator / planner / human_feedback / report_review / final_report_evaluator 用 Command
    builder.add_conditional_edges(
        "research_team",
        continue_to_running_research_team,
        ["researcher", "coder", "eval", "reporter"],
    )
    builder.add_edge("reporter", "report_review")
    # report_review →(Command)→ final_report_evaluator / reporter
    # final_report_evaluator →(Command)→ __end__ / planner

    memory = MemorySaver()
    return builder.compile(checkpointer=memory)


# 模块级单例
graph = build_graph()
