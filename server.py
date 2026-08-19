"""第8章服务启动入口。

用法：
    uv run server.py                    # 启动 HTTP 服务（默认 0.0.0.0:8000）
    PORT=9000 uv run server.py          # 换端口

启动后：
    - POST http://localhost:8000/api/chat/stream  （SSE 流式聊天）
    - GET  http://localhost:8000/api/conversations（会话列表）
    - GET  http://localhost:8000/api/conversation/{thread_id}
    - DELETE http://localhost:8000/api/conversation/{thread_id}
"""
import asyncio
import logging
import os
import sys

if sys.platform == "win32":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

# 加载 .env（启动服务时也需要，如 ENABLE_PYTHON_REPL / SEARCH_API / LLM key）
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("mini_deepresearch.server")


def main():
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    logger.info(f"启动 mini-deepresearch 服务: http://{host}:{port}")

    # ⭐ Windows + async psycopg 的关键：必须用 SelectorEventLoop（Proactor 不兼容）。
    # 但 uvicorn.run() 自己拉 event loop（Windows 默认 Proactor），忽略外部 policy；
    # 且 Python 3.14 起 set_event_loop_policy() 已 deprecated。
    # 正解：手写 asyncio.Runner(loop_factory=SelectorEventLoop) 自控 loop，
    # 再拉 uvicorn.Server（而非 uvicorn.run）——这是真实战踩坑与解法。
    config = uvicorn.Config("server.app:app", host=host, port=port, reload=False, loop="asyncio")
    server = uvicorn.Server(config)

    if sys.platform == "win32":
        # Windows：Selector 兼容 psycopg async
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(server.serve())
    else:
        # Linux/macOS：默认 loop 即可（psycopg async 兼容）
        asyncio.run(server.serve())


if __name__ == "__main__":
    main()
