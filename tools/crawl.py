"""crawl_tool：爬虫工具（@tool 函数式封装 + log_io 日志）。

参考 deepResearch 的 src/tools/crawl.py。
三种工具封装之一：@tool 装饰器（函数式）—— 最简单，适合无状态的纯调用。
"""
import asyncio
import logging
from typing import Annotated

from langchain_core.tools import tool

from crawler import Crawler
from tools.decorators import log_io

logger = logging.getLogger(__name__)


@tool
@log_io
async def crawl_tool(
    url: Annotated[str, "The url to crawl."],
) -> dict:
    """Use this to crawl a url and get a readable content in markdown format.
    用途：抓取指定网页，返回清洗后的 markdown 正文（前 1000 字）。
    """
    try:
        crawler = Crawler()
        # Crawler.crawl 内部走 jina_client.py 的同步 requests.post（Task 0.1 结论），
        # 用 to_thread 把阻塞调用丢线程池，不阻塞事件循环。
        article = await asyncio.to_thread(crawler.crawl, url)
        # 截断防止超长正文撑爆 LLM context
        return {"url": url, "crawled_content": article.to_markdown()[:1000]}
    except BaseException as e:
        error_msg = f"Failed to crawl. Error: {repr(e)}"
        logger.error(error_msg)
        return {"url": url, "crawled_content": error_msg}
