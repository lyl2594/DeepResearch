"""数据库基类：engine + SessionLocal + Base + init_db（加固版）。

本章可观测增量：在最小配（CB-1）基础上加连接池/statement_timeout/pool_pre_ping，
对齐主项目 deer-flow-aw/src/database/base.py。
"""
import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/postgres")

engine = create_engine(
    DATABASE_URL,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),       # 常驻连接数
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),  # 突发可溢出
    pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "3600")),  # 连接回收(秒)
    pool_pre_ping=True,                                    # 连接前 ping，防已断连接
    connect_args={
        "connect_timeout": 10,                             # 建连超时(秒)
        "options": "-c statement_timeout=30000",           # SQL 执行超时 30s，慢查询熔断
    },
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def init_db() -> None:
    """建表（首次启动调用）。"""
    from database import models  # noqa: F401

    Base.metadata.create_all(engine)
    logger.info(f"[database] 表已就绪（加固版连接池）：{DATABASE_URL}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
