# 爬取结果 content 为 markdown 正文

class Article:
    """一篇爬取到的文章。

    去掉 to_message 的图片分块，保留 to_markdown。
    """

    def __init__(self, title: str = "", content: str = ""):
        self.title = title or ""
        self.url = ""

        # content 统一存 markdown 正文（由 Jina 或 Readability 转好）
        self.content = content or ""

    def to_markdown(self, including_title: bool = True) -> str:
        """转成 markdown 字符串。
        """
        md = ""
        if including_title and self.title:
            md += f"#{self.title}\n\n"
        md += self.content
        return md