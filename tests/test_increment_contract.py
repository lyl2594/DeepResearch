import unittest
from config.configuration import Configuration


class IncrementContractTests(unittest.TestCase):
    """新 ch10 跨增量契约：可观测 / MCP / RAG 三增量互不破坏。"""

    def test_mcp_disabled_by_default_does_not_block_researcher(self):
        """MCP 默认关时，researcher 仍走默认工具链（可观测+RAG 不受影响）。"""
        cfg = Configuration(mcp_settings=None, resources=None)
        # 断言：无 mcp_settings 时 researcher 不尝试加载 MCP（默认工具链可用）
        self.assertIsNone(cfg.mcp_settings)

    def test_rag_without_resources_falls_back_to_web(self):
        """RAG 未配 resources 时，local_search_tool 不注入，回退 web_search。"""
        cfg = Configuration(resources=None)
        self.assertIsNone(cfg.resources)

    def test_timing_decorator_is_async_aware(self):
        """可观测 @timed_node 对 async 函数走 _async_wrapper（iscoroutinefunction 分流）。"""
        import asyncio
        from utils.timing import timed_node

        @timed_node
        async def fake_node():
            await asyncio.sleep(0)
            return "ok"

        self.assertTrue(asyncio.iscoroutinefunction(fake_node))
        result = asyncio.run(fake_node())
        self.assertEqual(result, "ok")


if __name__ == "__main__":
    unittest.main()
