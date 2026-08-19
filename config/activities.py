"""前端研究过程卡片使用的活动类型。"""
from enum import Enum
from typing import NamedTuple


class ActivityField(NamedTuple):
    type: str
    description: str


class ActivityType(Enum):
    """与原项目及前端 activity 展示契约保持一致。"""

    RECOGNIZE_KNOWY = ActivityField("recognize_knowy", "识别知识库")
    EXECUTE_RESEARCH = ActivityField("execute_research", "执行研究")
    RESEARCH_REPORT = ActivityField("research_report", "研究结果")
    EVALUATE_RESEARCH = ActivityField("evaluate_research", "评估研究结果")

    @property
    def type(self) -> str:
        return self._value_.type

    @property
    def description(self) -> str:
        return self._value_.description
