"""会话 CRUD：对话落库 + list/get/delete + 节点事件记录。

业务侧持久化（vs checkpointer）：这里存的是产品可见的结构化数据。
"""
import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import ChatStream, LanggraphEvent, RagConfig

logger = logging.getLogger(__name__)


# ---------- 对话流水 ----------

def append_chat_stream(
    db: Session, thread_id: str, event_type: str, content: str, finish_reason: str = "none"
) -> ChatStream:
    """追加一条对话事件（SSE 帧落库，支持刷新/重启后回看）。"""
    row = ChatStream(
        thread_id=thread_id,
        event_type=event_type,
        content=content,
        finish_reason=finish_reason,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_conversations(db: Session) -> list[dict]:
    """列出所有会话（thread_id 去重 + 最后更新时间 + 帧数统计）。

    沿用第8章同表结构下已验证的 Conversation 契约实现：
    - id / title / date / category / count / data_type

    本章与 ch08 共用逐帧 ChatStream 模型，不照搬主项目 research_replays 独立表；
    但返回字段严格对齐主项目前端 ConversationsDialog。
    """
    # 每个 thread_id 的最新时间 + 帧数
    stats = (
        db.query(
            ChatStream.thread_id,
            func.max(ChatStream.created_at).label("last_ts"),
            func.count(ChatStream.id).label("cnt"),
        )
        .group_by(ChatStream.thread_id)
        .order_by(func.max(ChatStream.created_at).desc())
        .all()
    )


    result = [ ]

    for tid, last_ts, cnt in stats:
        # 找该 thread 的首帧 content 作 title 摘要（截 30 字）
        first_row = (
            db.query(ChatStream.content)
            .filter(ChatStream.thread_id == tid, ChatStream.event_type == "message_chunk")
            .order_by(ChatStream.id)
            .first()
        )
        title = tid
        if first_row and first_row[0]:
            try:
                data = json.loads(first_row[0])
                if isinstance(data, dict):
                    content = (data.get("content") or "").strip()
                    if content:
                        title = content[:30] + ("…" if len(content) > 30 else "")
            except (ValueError, TypeError):
                pass

        result.append(
            {
                "id": tid,
                "title": title,
                "date": last_ts.isoformat() if last_ts else None,
                "category": "research",
                "count": cnt,
                "data_type": "chat",
                "thread_id": tid,
                "updated_at": last_ts.isoformat() if last_ts else None,
            }
        )
    return result


def get_conversation(db: Session, thread_id: str) -> list[dict]:
    """获取某会话的全部事件（按时间顺序，前端回放用）。"""
    rows = (
        db.query(ChatStream)
        .filter(ChatStream.thread_id == thread_id)
        .order_by(ChatStream.id)
        .all()
    )
    return [
        {
            "event_type": r.event_type,
            "content": r.content,
            "finish_reason": r.finish_reason,
        }
        for r in rows
    ]


def delete_conversation(db: Session, thread_id: str) -> int:
    """删除某会话的全部事件。返回删除条数。"""
    n = db.query(ChatStream).filter(ChatStream.thread_id == thread_id).delete()
    db.commit()
    return n


# ---------- 节点事件（业务可观测）----------

def log_graph_event(
    db: Session, thread_id: str, node: str, payload: dict, event_level: str = "info"
) -> LanggraphEvent:
    """记录节点事件（业务侧可观测，第9/10章细化）。"""
    row = LanggraphEvent(
        thread_id=thread_id,
        node=node,
        event_level=event_level,
        payload=json.dumps(payload, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    return row


def get_graph_events(db: Session, thread_id: str) -> list[dict]:
    """获取某会话的节点事件流水（业务可观测：无 LangSmith 也能复盘节点轨迹）。"""
    rows = (
        db.query(LanggraphEvent)
        .filter(LanggraphEvent.thread_id == thread_id)
        .order_by(LanggraphEvent.id)
        .all()
    )
    return [
        {
            "node": r.node,
            "level": r.event_level,
            "payload": r.payload,
            "time": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ---------- RAG 配置持久化 ----------

def list_rag_configs(db: Session) -> list[dict]:
    """列出所有 RAG 配置。"""
    rows = db.query(RagConfig).order_by(RagConfig.created_at.desc()).all()
    return [_rag_config_to_dict(r) for r in rows]


def create_rag_config(db: Session, config_id: str, data: dict) -> dict:
    """创建一条 RAG 配置。"""
    row = RagConfig(
        id=config_id,
        name=data["name"],
        platform=data["platform"],
        api_url=data.get("api_url", ""),
        ext_config=json.dumps(data.get("ext_config", {}), ensure_ascii=False),
        retrieval_size=data.get("retrieval_size", 5),
        similarity=data.get("similarity", 0.5),
        is_enabled=data.get("is_enabled", True),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _rag_config_to_dict(row)


def update_rag_config(db: Session, config_id: str, changes: dict) -> dict | None:
    """更新一条 RAG 配置，不存在返回 None。"""
    row = db.query(RagConfig).filter(RagConfig.id == config_id).first()
    if row is None:
        return None
    for key, value in changes.items():
        if key == "ext_config":
            row.ext_config = json.dumps(value, ensure_ascii=False)
        elif hasattr(row, key):
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _rag_config_to_dict(row)


def delete_rag_config(db: Session, config_id: str) -> bool:
    """删除一条 RAG 配置，返回是否成功。"""
    n = db.query(RagConfig).filter(RagConfig.id == config_id).delete()
    db.commit()
    return n > 0


def query_rag_resources(db: Session, query: str = "") -> list[dict]:
    """从已启用的 RAG 配置中检索匹配的资源。"""
    rows = db.query(RagConfig).filter(RagConfig.is_enabled == True).all()  # noqa: E712
    needle = query.casefold().strip()

    resources = [ ]

    for row in rows:
        try:
            ext = json.loads(row.ext_config) if row.ext_config else {}
        except (json.JSONDecodeError, TypeError):
            ext = {}

        for resource in ext.get("resources", []):

            haystack = " ".join(
                str(resource.get(k, ""))
                for k in ("uri", "title", "description")
            ).casefold()
            if not needle or needle in haystack:
                resources.append(dict(resource))
    return resources


def _rag_config_to_dict(row: RagConfig) -> dict:
    """RagConfig ORM 行 → dict（ext_config 反序列化 JSON）。"""
    try:
        ext = json.loads(row.ext_config) if row.ext_config else {}
    except (json.JSONDecodeError, TypeError):
        ext = {}
    return {
        "id": row.id,
        "name": row.name,
        "platform": row.platform,
        "api_url": row.api_url or "",
        "ext_config": ext,
        "retrieval_size": row.retrieval_size,
        "similarity": row.similarity,
        "is_enabled": row.is_enabled,
        # 契约兼容主项目 rag.py:114/138：前端 knowledge-tab.tsx:165 读 config.is_selected
        # 判断开关初始态。值语义与 is_enabled 相同，两者并存以对齐前端预期。
        "is_selected": row.is_enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
