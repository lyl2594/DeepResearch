import errno
import logging
from typing import Annotated

from langchain_core.tools import tool

from .article import Article
from .jina_client import JinaClient


# 爬虫入口
# 两条路径 
# 1. use_readability=False 直接用 Jina 返回 markdown 
# 2. use_readability=True jina 取 html + readabilityExtractor 清洗
class Crawler:
    def crawl(self, url: str, use_readability: bool = False) -> Article:
        """抓取单个 URL，返回 Article。"""
        client = JinaClient()
        if use_readability:
            from .readability_extractor import ReadabilityExtractor

            html = client.crawl(url, return_format="html")
            article = ReadabilityExtractor().extract_article(html)

        else:
            # 默认路径：Jina Reader 直接返回 markdown，无需额外依赖
            markdown_content = client.crawl(url, return_format="markdown")
            title = self._extract_title(markdown_content)
            article = Article(title=title, content=markdown_content)
            article.url = url
        return article

    @staticmethod
    def _extract_title(markdown_content: str) -> str:
        """从 markdown 正文里提取首个一级标题作为 title。"""
        for line in (markdown_content or "").splitlines():
            line = line.strip()
            if line.startswith("# "):
                return line[2:].strip()
        return ""

logger = logging.getLogger(__name__)

from tools.decorators import log_io

@tool
@log_io
def crawl_tool(url: Annotated[str, "The URL to use to crawl."]) -> dict:
    """
    Use this to crawl a url and get a readable content.
    用途：抓取指定网页，返回清理后的 markdown 正文（前1000字符）
    """
    try:
        crawler = Crawler()
        article = crawler.crawl(url)
        return {"url": url, "crawled_content": article.to_markdown()[:1000]}
    except Exception as e:
        error_msg = f"Failed to crawl.Error: {e}"
        logger.error(error_msg)
        return {"url": url, "error": error_msg}
