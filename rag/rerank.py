"""知识库检索后的 Rerank 操作，调用外部 rerank 接口，对检索到的文档进行排序。

移植自 deepResearch src/rag/rerank.py。
三处适配：
1. 模块路径：from src.rag.retriever → from rag.retriever；配置读取改用本地 _load_yaml_config（与 llm.py 同模式）
2. 懒加载：模块级单例 dmx_reranker 改为 get_reranker() 函数，避免 import 时触发初始化（空配置会抛 ValueError）
3. type 配置兼容 dmx|emb：支持 DMX 原格式（model/api_key/Authorization）和 emb 格式（/api/emb/rerank + contents/top_k），
   通过 RERANK_MODEL.type 配置项切换，默认 dmx。偏离主项目单 DMX 格式，但支持更多 rerank 服务。
"""

import json
from pathlib import Path

import requests
from pydantic import Field

from rag.retriever import Chunk, Document

# 配置文件路径：code/ 目录下的 conf.yaml（与 llm.py 同模式）
_CONF_PATH = Path(__file__).resolve().parent.parent / "conf.yaml"


def _load_yaml_config() -> dict:
    """读取 conf.yaml。"""
    import yaml

    if not _CONF_PATH.exists():
        return {}
    with open(_CONF_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def get_rerank_config() -> dict:
    config = _load_yaml_config()
    return config.get("RERANK_MODEL", {})


class DMXReranker:
    """Reranker uses AIHub rerank model to rerank documents."""

    name: str = "dmx_reranker"
    base_url: str = Field(..., description="The base URL of the rerank model API")
    model: str = Field(..., description="The name of the rerank model")
    api_key: str = Field(
        ..., description="The API key for authenticating with the rerank model"
    )
    top_n: int = Field(
        default=6, description="The number of top documents to return after reranking"
    )

    _instance = None

    def __init__(self):
        rerank_config = self.get_rerank_config()
        self.rerank_type = rerank_config.get("type", "dmx")
        self.base_url = rerank_config.get("base_url", "")
        self.model = rerank_config.get("model", "")
        self.api_key = rerank_config.get("api_key", "")
        self.top_n = rerank_config.get("top_n", 6)
        if self.rerank_type == "dmx":
            if not self.base_url or not self.model or not self.api_key:
                raise ValueError(
                    "dmx rerank: base_url, model, and api_key must be provided in the configuration"
                )
        elif self.rerank_type == "emb":
            if not self.base_url:
                raise ValueError(
                    "emb rerank: base_url must be provided in the configuration"
                )
        else:
            raise ValueError(
                f"Unsupported rerank type: {self.rerank_type!r}, expected 'dmx' or 'emb'"
            )

    def __new__(cls) -> "DMXReranker":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def get_rerank_config(self):
        config = _load_yaml_config()
        rerank_config = config.get("RERANK_MODEL", {})
        return rerank_config

    def rerank(self, query: str, records: list) -> list:
        """Rerank the documents based on the query.

        Args:
            query (str): The query text.
            records (list[dict]): The list of documents to rerank.

        Returns:
            list[dict]: The reranked list of documents.
        """
        if not records:

            return [ ]


        records_map = {idx: record for idx, record in enumerate(records)}

        if self.rerank_type == "emb":
            # emb 格式：POST {base_url}/rerank + {query, contents, top_k}
            payload = {
                "query": query,
                "contents": [r["content"] for r in records],
                "top_k": self.top_n,
            }
            response = requests.post(
                f"{self.base_url}/rerank", json=payload, timeout=30
            )
            response.raise_for_status()
            indices = [item["index"] for item in response.json()["data"]]
        else:
            # dmx 格式（原逻辑）：POST {base_url}/rerank + Authorization
            payload = {
                "model": self.model,
                "query": query,
                "top_n": self.top_n,
                "documents": [record["content"] for record in records],
            }
            headers = {
                "Authorization": f"{self.api_key}",
                "Content-Type": "application/json",
            }
            response = requests.post(
                f"{self.base_url}/rerank", headers=headers, data=json.dumps(payload)
            )
            response.raise_for_status()
            indices = [result["index"] for result in response.json()["results"]]

        return [records_map[idx] for idx in indices]


# 懒加载单例：首次调用时才初始化（读 conf.yaml），
# 避免 import 时因空 RERANK_MODEL 配置抛出 ValueError。
_reranker_instance: DMXReranker | None = None


def get_reranker() -> DMXReranker:
    """获取 DMXReranker 单例（懒加载）。

    首次调用时读取 conf.yaml 的 RERANK_MODEL 配置并初始化。
    Task 3 的 aihub.py 通过 get_reranker().rerank(query, records) 调用。
    """
    global _reranker_instance
    if _reranker_instance is None:
        _reranker_instance = DMXReranker()
    return _reranker_instance
