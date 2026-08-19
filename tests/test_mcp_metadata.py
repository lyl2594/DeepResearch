import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from server.app import app


class MCPMetadataTests(unittest.TestCase):
    def test_disabled_configuration_is_rejected(self):
        client = TestClient(app)
        with patch.dict("os.environ", {}, clear=True):
            response = client.post(
                "/api/mcp/server/metadata",
                json={"transport": "streamable_http", "url": "http://localhost:3000"},
            )
        self.assertEqual(response.status_code, 403)

    def test_enabled_configuration_returns_loaded_tool_metadata(self):
        client = TestClient(app)
        fake_tool = SimpleNamespace(
            name="search_docs",
            description="Search internal docs",
            args_schema=None,
        )
        with (
            patch.dict(
                "os.environ", {"ENABLE_MCP_SERVER_CONFIGURATION": "true"}
            ),
            patch(
                "server.app.load_mcp_tools",
                new=AsyncMock(return_value=[fake_tool]),
            ),
        ):
            response = client.post(
                "/api/mcp/server/metadata",
                json={"transport": "streamable_http", "url": "http://localhost:3000"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tools"][0]["name"], "search_docs")


if __name__ == "__main__":
    unittest.main()
