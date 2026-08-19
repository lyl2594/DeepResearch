"""MCP 工具加载：从 MCP server 动态加载工具（stdio / sse / streamable_http 三 transport）。

参考 deepResearch server/mcp_utils.py + graph/nodes.py:_setup_and_execute_agent_step。

用 langchain_mcp_adapters 的 MultiServerMCPClient（直接返回 LangChain Tool，agent 可调用）。
工具来源标注：description 加 `Powered by '<server>'.`，便于审计工具来源。

⚠️ 安全：MCP（尤其 stdio）可执行任意命令，必须 ENABLE_MCP_SERVER_CONFIGURATION=true 才启用。
默认关闭，避免任意命令执行风险。
"""
import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def load_mcp_tools(mcp_servers: dict, timeout_seconds: int = 60) -> list:
    """从多个 MCP server 加载工具，返回 LangChain Tool 列表。

    Args:
        mcp_servers: {server_name: {transport/command/args/url/env/headers}} 格式
        timeout_seconds: 单次加载超时（首次执行较慢，默认 60s）
    Returns:
        LangChain Tool 列表（加载失败返回空列表，不影响主流程）
    """
    if not mcp_servers:

        return [ ]


    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning(
            "[mcp] langchain-mcp-adapters 未安装，跳过 MCP 工具加载"
            "（pip install langchain-mcp-adapters）"
        )

        return [ ]


    try:
        client = MultiServerMCPClient(mcp_servers)
        tools = await asyncio.wait_for(client.get_tools(), timeout=timeout_seconds)
        logger.info(
            f"[mcp] 从 {len(mcp_servers)} 个 MCP server 加载 {len(tools)} 个工具: "
            f"{[t.name for t in tools]}"
        )
        return tools
    except TimeoutError:
        logger.error(f"[mcp] 加载 MCP 工具超时（{timeout_seconds}s）")

        return [ ]

    except Exception as e:
        logger.error(f"[mcp] 加载 MCP 工具失败（不影响主流程）: {e}")

        return [ ]



def is_mcp_enabled() -> bool:
    """ENABLE_MCP_SERVER_CONFIGURATION 双层校验（默认关）。"""
    import os

    return os.getenv("ENABLE_MCP_SERVER_CONFIGURATION", "false").lower() in (
        "true", "1", "yes", "on",
    )
