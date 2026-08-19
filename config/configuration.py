"""运行时配置：从 LangGraph 的 config 中读取可调参数。

简化自 deepResearch 的 src/config/configuration.py。
第4章新增：max_search_results（每次搜索结果数）、get_recursion_limit（ReAct 递归上限）。
后续章节会继续扩展（第6章 min_quality_score 等）。
"""
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class Configuration:
    """可调参数。"""

    max_plan_iterations: int = 1   # 最大规划轮次（防止无限规划）
    max_step_num: int = 3          # 单个计划的最大步骤数
    max_search_results: int = 5    # 第4章：每次搜索返回的结果数
    max_step_iterations: int = 3   # 第6章：单个步骤的最大重做次数（低分重做上限）
    min_quality_score: float = 0.7  # 第6章：步骤质量评分阈值（低于则重做）
    mcp_settings: dict = None      # 本章 MCP 增量：MCP server 配置（动态工具加载）
    resources: list = None         # 本章 RAG 增量：私有知识库资源
    rag_configs: list = None       # RAG 平台配置列表（PG 持久化，含 platform/ext_config 等）
    enable_background_investigation: bool = False
    enable_web_search: bool = False
    enable_rag: bool = True
    auto_select_kb: bool = True
    retriever_similarity: float = 0.4
    retriever_limit: int = 3
    report_style: str | None = None

    @classmethod
    def from_config(cls, config=None) -> "Configuration":
        """从 LangGraph 的 RunnableConfig 提取配置。

        config 形如 {"configurable": {"max_plan_iterations": 1, ...}}
        """
        configurable = {}
        if config and isinstance(config, dict):
            configurable = config.get("configurable", {}) or {}
        return cls(
            max_plan_iterations=int(configurable.get("max_plan_iterations", 1)),
            max_step_num=int(configurable.get("max_step_num", 3)),
            max_search_results=int(configurable.get("max_search_results", 5)),
            max_step_iterations=int(configurable.get("max_step_iterations", 3)),
            min_quality_score=float(configurable.get("min_quality_score", 0.7)),
            mcp_settings=configurable.get("mcp_settings"),
            resources=configurable.get("resources"),
            rag_configs=configurable.get("rag_configs"),
            enable_background_investigation=bool(
                configurable.get("enable_background_investigation", False)
            ),
            enable_web_search=bool(configurable.get("enable_web_search", False)),
            enable_rag=bool(configurable.get("enable_rag", True)),
            auto_select_kb=bool(configurable.get("auto_select_kb", True)),
            retriever_similarity=float(
                configurable.get("retriever_similarity", 0.4)
            ),
            retriever_limit=int(configurable.get("retriever_limit", 3)),
            report_style=configurable.get("report_style"),
        )


def get_recursion_limit(default: int = 100) -> int:
    """从环境变量 AGENT_RECURSION_LIMIT 读取 ReAct 递归上限。

    ReAct agent 在"思考→工具→观察"之间循环，recursion_limit 限制图的最大步数，
    防止 agent 陷入无限循环（这是图步数上限，不是 LLM 调用次数）。
    默认 100：多步研究一个步骤往往要搜索+推理数轮，25 太紧容易在研究员报错中断。
    """
    raw = os.getenv("AGENT_RECURSION_LIMIT", str(default))
    try:
        val = int(raw)
        if val > 0:
            return val
        logger.warning(
            f"AGENT_RECURSION_LIMIT 值 '{raw}' 非正数，使用默认 {default}"
        )
    except (ValueError, TypeError):
        logger.warning(f"AGENT_RECURSION_LIMIT 值 '{raw}' 非法，使用默认 {default}")
    return default
