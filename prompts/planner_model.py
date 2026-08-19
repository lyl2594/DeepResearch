"""Plan / Step 数据模型（Pydantic）。

简化自 deepResearch 的 src/prompts/planner_model.py。
planner 用这些模型约束 LLM 输出结构化的研究计划。
"""
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class StepType(str, Enum):
    """步骤类型。第2章只用 RESEARCH；PROCESSING（代码处理）第3章加 coder 后用。"""
    RESEARCH = "research"        # 需要搜索/检索的研究步骤
    PROCESSING = "processing"    # 需要代码处理的数据步骤


class Step(BaseModel):
    """单个研究步骤。"""
    need_search: bool = Field(..., description="该步骤是否需要搜索")
    title: str = Field(..., description="步骤标题")
    description: str = Field(..., description="明确要收集什么数据/信息")
    step_type: StepType = Field(..., description="步骤类型")
    # 以下字段由 researcher/eval 写入，planner 不填
    execution_res: Optional[str] = Field(default=None, description="步骤执行结果")
    evaluation_result: Optional[dict[Any, Any]] = Field(default=None, description="步骤评估结果（第6章 eval 写入）")
    step_iterations: int = Field(default=0, description="步骤重做次数（第6章 eval 递增，低分重做上限）")
    # 低分进入重试前保存最近一次完整结果；用户跳过重试时恢复它并继续后续步骤。
    last_execution_res: Optional[str] = Field(default=None, description="最近一次低分但可用的执行结果")
    last_evaluation_result: Optional[dict[Any, Any]] = Field(default=None, description="最近一次执行结果对应的评估")


class Plan(BaseModel):
    """完整研究计划。"""
    locale: str = Field(..., description="用户语言，如 zh-CN / en-US")
    has_enough_context: bool = Field(..., description="上下文是否已足够（true 则跳过研究直接报告）")
    thought: str = Field(default="", description="规划思路")
    title: str = Field(..., description="计划标题")
    steps: list[Step] = Field(default_factory=list, description="研究步骤列表")


# —— basic 模式用的最小版（with_structured_output 时用，字段更少更稳定）——
class StepMinimal(BaseModel):
    need_search: bool
    title: str
    description: str
    step_type: StepType


class PlanMinimal(BaseModel):
    locale: str
    has_enough_context: bool
    thought: str = ""
    title: str

    steps: list[StepMinimal] = [ ]



# —— 第6章新增：评估模型 ——


class EvaluationResponse(BaseModel):
    """评估响应（LLM structured_output 用）：质量评分 + 反馈。"""

    quality_score: float = Field(..., description="质量评分 0.0-1.0")
    feedback: str = Field(default="无具体反馈", description="评估反馈，markdown")


class EvaluationRecord(BaseModel):
    """评估记录（写入 evaluation_history）。"""

    step_title: str = Field(..., description="被评估步骤标题")
    step_type: str = Field(default="research", description="步骤类型")
    quality_score: float = Field(..., description="质量评分 0.0-1.0")
    feedback: str = Field(default="", description="评估反馈")
    evaluation_timestamp: datetime = Field(default_factory=datetime.now, description="评估时间")
    evaluator_name: str = Field(default="evaluator", description="评估者")
