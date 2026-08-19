import logging

logger = logging.getLogger(__name__)

class ReadabilityExtractor:
    def extract_article(self, html: str):
        """把 HTML 字符串抽成干净正文 Article。

        依赖 readability (readability 算法) + markdownify (html->md)。
        """
        try:
            from readability import simple_json_from_html_string
            from markdownify import markdownify as md
        except ImportError as e:
            raise ImportError(
                "ReadabilityExtractor 需要 readability 和 markdownify: "
                "pip install readability markdownify"
            ) from e

        from .article import Article

        article = simple_json_from_html_string(html, use_readability=True)
        title = article.get("title") or ""
        html_content = article.get("content") or ""
        # 清洗后的 html 片段转成 markdown
        return Article(title=title, content=md(html_content))