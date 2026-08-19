"""RAG 配置 API 测试：mock repository 层，验证 service 逻辑。

Mock 范围（不依赖 PostgreSQL，本地秒跑）：
- database.base.get_db（L86）→ 注入 _fake_session，阻止 app startup 连 PG
- server.app.get_db（L104）→ 覆盖 Depends 注入点（app 模块级 import 时捕获的引用）
- database.repository 的 5 个函数（L87-94）→ patch.multiple 注入纯内存 mock

内存 mock 实现（L38-83）：
- _mock_store: dict[str, dict]（L38）— 纯 Python dict 替代 PG 表
- _mock_create（L41）/ _mock_list（L57）/ _mock_update（L61）/ _mock_delete（L69）
  / _mock_query_resources（L73）— 5 个函数模拟 repository 的 CRUD + 资源查询

诚实声明 — mock 局限性：
RAGConfigService 当前是薄 pass-through（create 仅生成 UUID + model_dump，
list/update/delete/query_resources 直转 repository）。因此上述 mock 函数
不可避免地复刻了 repository 的字段提取/过滤逻辑（如 _mock_query_resources
的 casefold 子串匹配与 repository 实现一致）。

⚠ 警告：若未来给 RAGConfigService 增加校验/转换/清洗逻辑（例如 name 长度
校验、ext_config schema 验证、similarity 精度截断），这些 mock 不会暴露问题
——届时需同步更新 mock 实现，或改用真实 PG 集成测试覆盖。

验证什么：
- service 层正确调用 repository 函数（传参、转发返回值）
- FastAPI 端点的 HTTP 状态码、响应结构
- pydantic 校验（similarity 越界 → 422）
- delete 返回 deleted: true
"""
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

# --- mock 进驻点（必须在 import app 之前）---
_fake_session = MagicMock(name="fake_db_session")

# repository 函数的 mock 实现（模拟内存行为）
_mock_store: dict[str, dict] = {}


def _mock_create(db, config_id: str, data: dict) -> dict:
    entry = {
        "id": config_id,
        "name": data["name"],
        "platform": data["platform"],
        "api_url": data.get("api_url", ""),
        "ext_config": data.get("ext_config", {}),
        "retrieval_size": data.get("retrieval_size", 5),
        "similarity": data.get("similarity", 0.5),
        "is_enabled": data.get("is_enabled", True),
        "created_at": "2026-01-01T00:00:00",
    }
    _mock_store[config_id] = entry
    return entry


def _mock_list(db) -> list[dict]:
    return list(_mock_store.values())


def _mock_update(db, config_id: str, changes: dict) -> dict | None:
    entry = _mock_store.get(config_id)
    if entry is None:
        return None
    entry.update(changes)
    return entry


def _mock_delete(db, config_id: str) -> bool:
    return _mock_store.pop(config_id, None) is not None


def _mock_query_resources(db, query: str = "") -> list[dict]:
    needle = query.casefold().strip()
    resources = []
    for entry in _mock_store.values():
        if not entry.get("is_enabled", True):
            continue
        for r in entry.get("ext_config", {}).get("resources", []):
            haystack = " ".join(str(r.get(k, "")) for k in ("uri", "title", "description")).casefold()
            if not needle or needle in haystack:
                resources.append(dict(r))
    return resources


_patcher_get_db = patch("database.base.get_db", return_value=_fake_session)
_patcher_repo = patch.multiple(
    "database.repository",
    list_rag_configs=_mock_list,
    create_rag_config=_mock_create,
    update_rag_config=_mock_update,
    delete_rag_config=_mock_delete,
    query_rag_resources=_mock_query_resources,
)

# 在 mock 生效后 import app（app 模块级 import 会触发 get_db 注册）
_patcher_get_db.start()
_patcher_repo.start()

# 注意：还需 patch app 模块里的 get_db 引用（Depends 拿到的是 app 导入时的 get_db）
from server.app import app  # noqa: E402

# app 里 `Depends(get_db)` 引用的是 server.app 作用域的 get_db，需额外 patch
_patcher_app_get_db = patch("server.app.get_db", return_value=_fake_session)
_patcher_app_get_db.start()


class RAGConfigAPITests(unittest.TestCase):
    def setUp(self):
        """每个测试前清空 mock 存储。"""
        _mock_store.clear()
        self.client = TestClient(app)

    def test_config_crud_and_resource_query(self):
        """完整 CRUD 生命周期 + query_resources（mock repository，无 PG）。"""
        payload = {
            "name": "memory-demo",
            "platform": "memory",
            "api_url": "",
            "ext_config": {
                "resources": [
                    {
                        "uri": "rag://guide",
                        "title": "中文指南",
                        "description": "课程资料",
                        "chunks": ["上下文管理"],
                    }
                ]
            },
            "retrieval_size": 5,
            "similarity": 0.5,
            "is_enabled": True,
        }

        # create
        created = self.client.post("/api/config/rag/save_config", json=payload)
        self.assertEqual(created.status_code, 200)
        config_id = created.json()["data"]["id"]
        self.assertTrue(len(config_id) > 0, "create 应返回非空 id")

        # list
        listed = self.client.get("/api/config/rag/get_config")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["data"][0]["name"], "memory-demo")

        # query_resources
        resources = self.client.get("/api/rag/resources", params={"query": "中文"})
        self.assertEqual(resources.status_code, 200)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://guide")

        # update
        updated = self.client.put(
            f"/api/config/rag/{config_id}", json={"name": "updated"}
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["name"], "updated")

        # delete
        deleted = self.client.delete(f"/api/config/rag/{config_id}")
        self.assertTrue(deleted.json()["deleted"])

    def test_invalid_similarity_returns_structured_detail(self):
        """similarity 超出 [0,1] → 422 + detail。"""
        response = self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "bad",
                "platform": "memory",
                "api_url": "",
                "ext_config": {},
                "retrieval_size": 5,
                "similarity": 2,
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("detail", response.json())

    def test_update_nonexistent_returns_404(self):
        """更新不存在的 config_id → 404。"""
        response = self.client.put(
            "/api/config/rag/nonexistent_id", json={"name": "ghost"}
        )
        self.assertEqual(response.status_code, 404)

    def test_query_resources_empty_query_returns_all_enabled(self):
        """query_resources 无 query 参数 → 返回所有已启用配置的资源。"""
        self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "cfg1",
                "platform": "memory",
                "ext_config": {
                    "resources": [
                        {"uri": "rag://a", "title": "Alpha", "description": "第一"},
                    ]
                },
                "is_enabled": True,
            },
        )
        resources = self.client.get("/api/rag/resources")
        self.assertEqual(resources.status_code, 200)
        self.assertEqual(len(resources.json()["resources"]), 1)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://a")

    def test_query_resources_filters_by_query(self):
        """query_resources 带 query → 按 uri/title/description 过滤。"""
        self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "cfg2",
                "platform": "memory",
                "ext_config": {
                    "resources": [
                        {"uri": "rag://python", "title": "Python 教程", "description": "基础"},
                        {"uri": "rag://rust", "title": "Rust 指南", "description": "进阶"},
                    ]
                },
                "is_enabled": True,
            },
        )
        resources = self.client.get("/api/rag/resources", params={"query": "Python"})
        self.assertEqual(len(resources.json()["resources"]), 1)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://python")

    def test_delete_nonexistent_returns_false(self):
        """删除不存在的 config_id → deleted: false。"""
        deleted = self.client.delete("/api/config/rag/ghost_id")
        self.assertFalse(deleted.json()["deleted"])


if __name__ == "__main__":
    unittest.main()
