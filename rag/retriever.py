"""RAG Retriever 抽象 + 数据模型。

简化自 deepResearch src/rag/retriever.py。
Retriever 是 RAG provider 的抽象（开闭原则：新 provider 只需实现 list_resources + query_relevant_documents）。
教学版 Retriever 用纯 ABC（不继承 BaseModel，方便子类持有状态如内存 dict）。
"""
import abc

from pydantic import BaseModel, Field, field_validator


class Chunk:
    """检索片段：内容 + 相似度。"""

    def __init__(self, content: str, similarity: float = 1.0):
        self.content = content
        self.similarity = similarity


class Document:
    """检索文档：id + 标题 + chunks。"""

    def __init__(
        self,
        id: str,
        title: str = "",
        url: str | None = None,
        chunks: list[Chunk] | None = None,
        resource_title: str = "",
        rag_platform_id: str = "",
        authorization: str | None = None,
    ):
        self.id = id
        self.title = title
        self.url = url

        self.chunks = chunks or [ ]

        self.resource_title = resource_title
        self.rag_platform_id = rag_platform_id
        self.authorization = authorization

    def to_dict(self) -> dict:
        # 契约对齐原项目 reference-source/deer-flow-aw/src/rag/retriever.py:54-64：
        # 前端 research-activities-block.tsx 的 RetrieverToolCall 组件消费这些字段：
        #   - resource_title：显示"来源：XXX"
        #   - chunks（含 similarity）：ContentDialog 里逐 chunk 展示 + 相似度分
        #   - rag_platform_id：前端多 provider 场景下的归属标记
        # 缺任一都会让检索结果卡片信息不全。
        d = {
            "id": self.id,
            "title": self.title,
            "content": "\n\n".join(c.content for c in self.chunks),
            "resource_title": self.resource_title,
            "rag_platform_id": self.rag_platform_id,
            "chunks": [
                {"content": chunk.content, "similarity": chunk.similarity}
                for chunk in self.chunks
            ],
        }
        if self.url:
            d["url"] = self.url
        if self.authorization:
            d["authorization"] = self.authorization
        return d


class Resource(BaseModel):
    """知识库资源（用户选择/检索的 KB 条目）。"""

    uri: str = Field(..., description="资源 URI（rag:// 协议）")
    title: str = Field(..., description="资源标题")
    rag_platform_id: str = Field(default="", description="RAG 平台 ID")
    description: str = Field(default="", description="资源描述")
    tag: str = Field(default="", description="资源标签")

    @field_validator("title", "description", "tag", mode="before")
    def convert_none_to_empty_string(cls, v):
        """将 None 转换为空字符串，防止外部 API 返回 None 时触发验证错误。"""
        return v or ""


class Retriever(abc.ABC):
    """RAG provider 抽象：list_resources + query_relevant_documents。

    实现这两个方法即为一个 provider（ES/RAGFlow/内存/…），开闭原则。
    """

    rag_platform_id: str = ""

    @abc.abstractmethod
    def list_resources(self, query: str | None = None) -> list[Resource]:
        """列出知识库资源。"""

    @abc.abstractmethod
    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        """检索相关文档。"""
