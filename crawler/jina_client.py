import logging
import os

import requests

logger = logging.getLogger(__name__)


class JinaClient:
    def crawl(self, url: str, return_format: str = "markdown") -> str:
        """调用 Jina Reader 抓取单个 URL。

        Args:
            url: 要抓取的网页地址
            return_format: 返回格式, "markdown" (默认, 直接可用) 或 "html" (配合
        """
        headers = {
            "Content-Type": "application/json",
            "X-Return-Format": return_format,
        }
        if os.getenv("JINA_API_KEY"):
            headers["Authorization"] = f"Bearer {os.getenv('JINA_API_KEY')}"
        else:
            logger.warning(
                "[crawler] 未配置 JINA_API_KEY, 使用免费额度 (速率受限)。"
                "可在 https://jina.ai/reader 申请 key 提高限额。"
            )
        data = {"url": url}
        response = requests.post(
            "https://r.jina.ai/", headers=headers, json=data, timeout=30
        )
        response.raise_for_status()
        return response.text