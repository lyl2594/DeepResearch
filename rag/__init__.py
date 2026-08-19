"""RAG 模块：Retriever 抽象 + provider（教学版内存 provider，生产 ES/RAGFlow）。"""
from .retriever import Chunk, Document, Resource, Retriever

__all__ = ["Chunk", "Document", "Resource", "Retriever"]
