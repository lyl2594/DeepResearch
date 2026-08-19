"""请求模型：ChatRequest（聊天流式 + HITL resume）。"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    """聊天流式请求。

    - messages: 对话消息 [{"role":"user","content":"..."}]
    - thread_id: 会话ID（不传则新建；HITL resume 时传回原 thread_id）
    - auto_accepted_plan: 是否跳过 HITL 计划/报告审核（默认 True 自动跑）
    - interrupt_feedback: HITL 反馈（ACCEPTED/EDIT_PLAN/CONTINUE），resume 时用
    """

    model_config = ConfigDict(extra="ignore")  # 前端骨架传超集字段，忽略未知

    messages: list[dict]
    thread_id: Optional[str] = None
    auto_accepted_plan: bool = True
    interrupt_feedback: Optional[str] = None
    plan: Optional[dict] = None
    max_plan_iterations: int = 2
    max_step_num: int = 3
    max_search_results: int = 5
    # 步骤评估阈值 & 重做上限（前端 Settings → 通用 面板的两个滑块传入）：
    # 前端字段名 min_step_score / max_step_retry，映射到后端 Configuration
    # 的 min_quality_score / max_step_iterations。默认沿用 Configuration 的默认值。
    min_step_score: Optional[float] = None
    max_step_retry: Optional[int] = None
    enable_deep_thinking: bool = False
    enable_background_investigation: bool = False
    enable_web_search: bool = False
    enable_rag: bool = True
    auto_select_kb: bool = True
    report_style: Optional[str] = None
    retriever_similarity: float = 0.4
    retriever_limit: int = 3
    param_list: list[dict] = Field(default_factory=list)
    mcp_settings: dict = Field(default_factory=dict)
    resources: list = Field(default_factory=list)
    rag_configs: list = Field(default_factory=list)


class SkipRequest(BaseModel):
    """跳过当前执行步骤的控制请求。"""

    thread_id: str
