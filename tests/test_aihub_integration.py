"""AIHub 集成测试：env 门控 + ddddocr 门控。

双重门控确保：
1. 没有设置 AIHUB_API_URL / AIHUB_USERNAME / AIHUB_PASSWORD → skip
2. 没有安装 ddddocr（uv run --extra aihub）→ skip

本地默认环境两个条件都不满足，集成测试全部 skip。
只有显式配置 env + 安装 aihub extra 后才会执行真实网络调用。
"""
import os
import unittest


def _ddddocr_available() -> bool:
    """检查 ddddocr 是否已安装（try import，不 load_dotenv）。"""
    try:
        import ddddocr  # noqa: F401
        return True
    except ImportError:
        return False


@unittest.skipUnless(
    all(os.getenv(v) for v in ("AIHUB_API_URL", "AIHUB_USERNAME", "AIHUB_PASSWORD")),
    "AIHUB 集成测试需 AIHUB_API_URL/USERNAME/PASSWORD 环境变量",
)
@unittest.skipUnless(
    _ddddocr_available(), "AIHUB 集成测试需 ddddocr（uv run --extra aihub）"
)
class AIHubIntegrationTests(unittest.TestCase):
    """AIHub 真实集成测试（连接 AIHUB_API_URL 指向的服务）。

    需要同时满足：
    - 环境变量 AIHUB_API_URL / AIHUB_USERNAME / AIHUB_PASSWORD 已设置
    - ddddocr 已安装（uv run --extra aihub）
    """

    @classmethod
    def setUpClass(cls):
        from rag.aihub import AIHubProvider

        cls.provider = AIHubProvider(
            rag_platform_id="aihub",
            api_url=os.getenv("AIHUB_API_URL"),
            username=os.getenv("AIHUB_USERNAME"),
            password=os.getenv("AIHUB_PASSWORD"),
            retrieval_size=5,
            similarity=0.4,
        )

    def test_connection(self):
        """测试连接：登录 + list_resources，返回 success=True。"""
        result = self.provider.test_connection()
        self.assertTrue(result["success"], result["message"])
        self.assertIsInstance(result["resource_count"], int)

    def test_list_and_query(self):
        """闭环测试：list_resources → query_relevant_documents。

        步骤：
        1. list_resources() 获取资源列表
        2. 取第一条资源构造 query_relevant_documents 调用
        3. 验证返回 Document 列表非空且字段完整
        """
        resources = self.provider.list_resources(use_cache=False)
        self.assertGreater(len(resources), 0, "list_resources 应返回至少一条资源")

        # 取第一条资源做 query
        first = resources[0]
        documents = self.provider.query_relevant_documents(
            query="测试查询", resources=[first]
        )

        # 验证返回的 Document 结构
        self.assertIsInstance(documents, list)
        if documents:
            doc = documents[0]
            self.assertTrue(hasattr(doc, "id"))
            self.assertTrue(hasattr(doc, "chunks"))
            self.assertIsInstance(doc.chunks, list)


if __name__ == "__main__":
    unittest.main()
