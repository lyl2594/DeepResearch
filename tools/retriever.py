"""RetrieverTool：local_search_tool（BaseTool，从私有知识库检索）。

参考 deepResearch tools/retriever.py。
researcher 用它检索私有知识库（vs web_search 联网）。
RAG-web 协同：本地无结果时 researcher 自主转 web（prompt 引导 + 工具描述提示）。

契约对齐原项目 reference-source/deer-flow-aw/src/tools/retriever.py：
- 参数名用 `keywords`（前端 KeywordsList 组件读的就是 toolCall.args.keywords）
- 返回 list[dict]（前端 RetrieverToolCall 用 parseJSON 消费），不返回 markdown
- description 保持原项目原文，鼓励 LLM 优先调用本地检索
"""
import logging
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from rag.retriever import Document, Resource, Retriever


class _LocalSearchInput(BaseModel):
    keywords: str = Field(..., description="search keywords to look up")


class RetrieverTool(BaseTool):
    """local_search_tool：检索私有知识库。"""

    name: str = "local_search_tool"
    description: str = (
        "优先使用！用于从用户的私有知识库中检索相关文档和信息。"
        "在进行任何网络搜索之前，应首先使用此工具查询私有知识库。"
        "输入为搜索关键词。这是获取权威、准确信息的最佳途径。"
    )
    args_schema: type = _LocalSearchInput
    retrievers: list[Any] = Field(default_factory=list)  # 对齐原项目：合并多 provider
    resources: list = Field(default_factory=list)

    def _run(self, keywords: str, **kwargs) -> list[dict]:
        logger = logging.getLogger(__name__)
        logger.info(f"[local_search_tool] 被调用，关键词: {keywords!r}")
        logger.info(f"[local_search_tool] retrievers 数量: {len(self.retrievers)}")
        logger.info(f"[local_search_tool] resources 数量: {len(self.resources)}")
        
        if not self.retrievers:
            logger.warning("[local_search_tool] 没有可用的 retrievers，返回空列表")
            # 空 list：前端 RetrieverToolCall 会显示"当前没有检索到相关知识库来源"
            # LLM 看到空列表也会自主转向 web_search
            return [ ]


        docs = [ ]

        for i, retriever in enumerate(self.retrievers):
            logger.info(f"[local_search_tool] 使用第 {i+1}/{len(self.retrievers)} 个 retriever 检索")
            retriever_docs = retriever.query_relevant_documents(keywords, self.resources)
            logger.info(f"[local_search_tool] retriever 返回 {len(retriever_docs)} 条文档")
            docs.extend(retriever_docs)
        
        logger.info(f"[local_search_tool] 总共检索到 {len(docs)} 条文档")
        
        if not docs:
            logger.info("[local_search_tool] 未检索到任何文档，返回空列表")
            return [ ]

        # 返回 list[dict]（不是 markdown 字符串）—— 前端 parseJSON 需要 JSON 数组。
        # Document.to_dict() 已包含 {id, title, content, url?, authorization?} 字段。
        result = [d.to_dict() for d in docs]
        logger.info(f"[local_search_tool] 返回 {len(result)} 条文档数据")
        return result

    async def _arun(self, keywords: str, **kwargs) -> list[dict]:
        return self._run(keywords, **kwargs)


def make_local_search_tool(retrievers: list[Retriever], resources: list[Resource] | None = None) -> RetrieverTool:
    """工厂：创建 local_search_tool（传入多个 Retriever + 用户选择的 resources）。"""

    return RetrieverTool(retrievers=retrievers, resources=resources or [])

