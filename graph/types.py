"""State 定义：贯穿整个研究流程的状态模式。

继承 MessagesState → messages 字段自带 add reducer（多节点返回的 messages 会自动累加）。
其他字段默认 last-write-wins（后写覆盖前写）。

第2章新增：current_plan / plan_iterations / auto_accepted_plan。
"""
from typing import Annotated

from langgraph.graph import MessagesState

from prompts.planner_model import EvaluationRecord, Plan


def add_list(left: list | None, right: list | None) -> list:
    """列表累加 reducer：用于需要跨节点累积的字段（如 observations）。"""

    return (left or []) + (right or [])



class State(MessagesState):
    """deepresearch 系统的全局状态。"""

    # —— 第1章字段 ——
    locale: str
    research_topic: str
    observations: Annotated[list[str], add_list]
    final_report: str

    # —— 第2章新增 ——
    # 当前研究计划（planner 写入 Plan 对象）
    current_plan: Plan | str | None
    # 规划轮次计数（防止无限规划）
    plan_iterations: int
    # 是否跳过 HITL 计划审核（第2章恒 True，第5章引入真正的 interrupt）
    auto_accepted_plan: bool

    # —— 第5章新增 ——
    # 用户内联编辑的计划（前端回灌；human_feedback_node 用 _merge_plan_edits 合并）
    edited_plan: dict | None

    # —— 第6章新增 ——
    # 评估历史（每个研究步骤 + 终评的记录）
    evaluation_history: Annotated[list[EvaluationRecord], add_list]
    # 最终报告评估结果
    final_report_evaluation: dict | None
    # 当前正在执行的步骤标识（researcher/coder 每步开始时写入，
    # server/_process_message_chunk 读它决定 base.step / step_title，
    # 前端 research-activities-block 按 step 分组渲染，缺失时 eval 卡片渲染位置错乱）
    step: str
    step_title: str
    # 检索审核：前端修改检索参数后随 HITL resume 回灌。
    param_list: list[dict]
    pending_retrieval_review: dict | None
    pending_execution_res: str | None
