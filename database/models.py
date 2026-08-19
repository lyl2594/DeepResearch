"""业务表：会话生命周期。

简化自 deepResearch 的 4 表（chat_streams / custom_templates / langgraph_events / research_replays）。
教学版第8章做核心 2 表（业务侧持久化的基石）：
  - ChatStream：对话全文分片（每个 SSE 帧存一行，支持刷新页面看历史 + 重启恢复）
  - LanggraphEvent：节点事件流水（业务可观测，第9/10章细化）
custom_templates（新 ch11「研究产出加工」报告模板）/ research_replays（第9章回放索引）后续章节加。

vs checkpointer：checkpointer 存的是 langgraph 内部状态（resume 用），偏开发态；
业务表存的是"给用户/产品看的"结构化数据（对话全文、事件、回放），偏产品态。
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from database.base import Base


class ChatStream(Base):
    """对话流水分片表：每个 SSE 帧存一行。"""

    __tablename__ = "chat_streams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    thread_id = Column(String, nullable=False, index=True, comment="会话ID")
    event_type = Column(String, nullable=False, comment="事件类型 message_chunk/tool_calls/...")
    content = Column(Text, comment="事件数据（SSE 帧 JSON）")
    finish_reason = Column(String, default="none", comment="结束原因 none/stop")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )


class LanggraphEvent(Base):
    """节点事件流水：业务可观测（无 LangSmith 也能复盘，合规行业必备）。"""

    __tablename__ = "langgraph_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    thread_id = Column(String, nullable=False, index=True, comment="会话ID")
    node = Column(String, nullable=False, comment="节点名 researcher/reporter/...")
    event_level = Column(String, default="info", comment="日志级别 info/warning/error")
    payload = Column(Text, comment="JSON 序列化的事件数据")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )


class RagConfig(Base):
    """RAG 知识库配置（多 platform：memory/aihub/...）。PG 持久化。"""

    __tablename__ = "rag_configs"

    id = Column(String, primary_key=True, comment="uuid4 hex")
    name = Column(String, nullable=False)
    platform = Column(String, nullable=False, comment="memory|aihub|...")
    api_url = Column(String, default="")
    ext_config = Column(Text, default="{}", comment="JSON: username/password/resources/...")
    retrieval_size = Column(Integer, default=5)
    similarity = Column(Float, default=0.5)
    is_enabled = Column(Boolean, default=True)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )
