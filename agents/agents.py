"""Agent 工厂：用 langgraph.prebuilt.create_react_agent 创建 ReAct agent。

参考 deepResearch 的 src/agents/agents.py。

ReAct = Reasoning + Acting：LLM 自主决定"思考 → 调用工具 → 观察结果 → 再思考"循环，
直到认为信息足够才给出最终答案（而非像第3章那样固定搜一次）。
这是研究员"自主多轮推理"（该不该再搜、再爬）的能力来源。

pre_model_hook：每次 LLM 调用前触发的钩子。
第4章用 token 观察器（只记录不改）；第7章升级为 ContextManager 压缩器。
"""
from typing import Any, Callable, Optional

from langgraph.prebuilt import create_react_agent

from llm import get_llm_by_type
from prompts.template import apply_prompt_template


import logging

logger = logging.getLogger(__name__)

def create_agent(
    agent_name: str,
    agent_type: str,
    tools: list,
    prompt_template: str,
    pre_model_hook: Optional[Callable] = None,
    prompt_context: Optional[dict] = None,
) -> Any:
    """创建一个 ReAct agent（带工具 + prompt + pre_model_hook）。

    Args:
        agent_name: agent 名称（如 "researcher" / "coder"）
        agent_type: agent 类型。deepResearch 用 AGENT_LLM_MAP 选不同 LLM；
                    教学版统一用 "basic"，避免引入多模型配置。
        tools: 该 agent 可用的工具列表（LangChain BaseTool）
        prompt_template: prompt 模板名（prompts/<name>.md，不含后缀）
        pre_model_hook: 每次 LLM 调用前的钩子（token 观察器 / 第7章 ContextManager）
    """
    tool_names = [getattr(t, "name", str(t)) for t in tools]
    logger.info(f"[create_agent] 创建 agent: {agent_name}, 工具列表: {tool_names}")
    logger.info(f"[create_agent] prompt_context: {prompt_context}")
    
    # 关键步骤：将工具绑定到 LLM，否则 LLM 不知道可以调用这些工具
    llm = get_llm_by_type("basic")
    llm_with_tools = llm.bind_tools(tools)
    
    return create_react_agent(
        name=agent_name,
        model=llm_with_tools,  # 使用绑定了工具的 LLM
        tools=tools,           # 仍然需要传递工具给 agent
        prompt=lambda state: apply_prompt_template(
            prompt_template,
            {**state, **(prompt_context or {})},
        ),
        pre_model_hook=pre_model_hook,
    )
