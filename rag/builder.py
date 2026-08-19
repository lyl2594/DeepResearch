"""Retriever 工厂：按配置构建 provider。

教学版支持 memory provider（从 list[dict] 构建）。
生产扩展：根据配置 platform 字段选择 ES/RAGFlow/AIHub/… provider（开闭原则）。
"""
from rag.retriever import Retriever


def build_retriever_by_configs(
    resources: list[dict] | None = None,
    enabled_configs: list[dict] | None = None,
    similarity: float = 0.4,
    retriever_keyword: str = "",
    override_similarity: bool = False,
) -> list[Retriever]:
    """从资源列表或平台配置构建 Retriever。

    Args:
        resources: [{"uri":..., "title":..., "desc":..., "chunks":[str]}]（内存格式，教学主线）
        enabled_configs: [{"platform":..., "rag_platform_id":..., "api_url":...,
                           "retrieval_size":..., "ext_config": {...}}]（平台配置，如 aihub）
        similarity: 检索相似度阈值（平台配置生效）
        retriever_keyword: 检索关键词（预留字段，当前未 per-config 持久化——
                         RagConfig 表/前端 UI 均无此键，走函数默认 ""；
                         similarity 已 per-config 生效）
    Returns:

        Retriever 列表；空则 []。与原项目 build_retriever_by_configs 一致，

        所有启用配置都会参与检索。

    优先使用 enabled_configs（平台配置），为空时回退到 resources（内存格式）。
    """
    # ── 平台配置分支（aihub 等） ──
    if enabled_configs:

        retrievers: list[Retriever] = [ ]

        for config in enabled_configs:
            platform = config.get("platform", "")
            if platform == "aihub":
                from rag.aihub import AIHubProvider

                username = config.get("ext_config", {}).get("username")
                password = config.get("ext_config", {}).get("password")
                retrievers.append(AIHubProvider(
                    rag_platform_id=config.get("rag_platform_id", ""),
                    api_url=config.get("api_url", ""),
                    username=username or "",
                    password=password or "",
                    retrieval_size=config.get("retrieval_size", 10),
                    similarity=(
                        similarity
                        if override_similarity
                        else config.get("similarity", similarity)
                    ),
                    retriever_keyword=config.get("retriever_keyword", retriever_keyword),
                ))
        return retrievers

    # ── 内存格式分支（教学主线） ──
    if not resources:

        return [ ]

    from rag.memory import MemoryRetriever

    kb = {}
    for r in resources:
        uri = r.get("uri") or r.get("title") or ""
        if not uri:
            continue
        kb[uri] = {
            "title": r.get("title", uri),
            "desc": r.get("desc", ""),

            "chunks": r.get("chunks", []) or [],

        }

    return [MemoryRetriever(kb)] if kb else [ ]

