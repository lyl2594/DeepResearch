"""RAG 配置服务：PG 持久化后端。

接口签名与原内存版保持一致（list_configs / create / update / delete / query_resources / clear），
仅存储后端从内存 dict → PG repository。
"""
from uuid import uuid4

from sqlalchemy.orm import Session

from database import repository
from server.rag_request import RAGConfigPayload


class RAGConfigService:
    """RAG 配置仓库：PG 持久化（接口不变，对齐前端 API 契约）。"""

    def list_configs(self, db: Session) -> list[dict]:
        return repository.list_rag_configs(db)

    def create(self, db: Session, payload: RAGConfigPayload) -> dict:
        config_id = uuid4().hex
        return repository.create_rag_config(db, config_id, payload.model_dump())

    def update(self, db: Session, config_id: str, changes: dict) -> dict | None:
        return repository.update_rag_config(db, config_id, changes)

    def delete(self, db: Session, config_id: str) -> bool:
        return repository.delete_rag_config(db, config_id)

    def query_resources(self, db: Session, query: str = "") -> list[dict]:
        return repository.query_rag_resources(db, query)

    def clear(self, db: Session) -> None:
        """清空全部配置（测试用）。"""
        from database.models import RagConfig

        db.query(RagConfig).delete()
        db.commit()


rag_config_service = RAGConfigService()
