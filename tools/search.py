"""搜索工具：标准化结果 + 多引擎 + 三种封装 + 后处理整合。

第3章在第二章极简版基础上的升级：
1. web_search() 返回**标准化**结果（统一字段 type/url/title/content/raw_content/score），
   供 researcher 主线使用；内部接入 SearchResultPostProcessor 做 5 道工序清洗。
2. 多引擎：SEARCH_API 环境变量切换 duckduckgo（默认，免 key）/ tavily（需 key，支持域名黑白名单）/ none（禁用）。
3. 三种工具封装全部展示：
   - @tool 函数式    → crawl_tool / python_repl_tool（见各自文件）
   - BaseTool 子类   → WebSearchTool（本文件）
   - create_logged_tool 工厂 → LoggedWebSearchTool（本文件，给第4章 ReAct agent 用）

参考 deepResearch 的 src/tools/search.py + search_postprocessor.py。
"""
import asyncio
import logging
import os

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from tools.decorators import create_logged_tool
from tools.search_postprocessor import SearchResultPostProcessor

logger = logging.getLogger(__name__)


# ============ 引擎选择 ============

def _get_engine() -> str:
    """读取搜索引擎选择（环境变量 SEARCH_API，默认 duckduckgo）。"""
    return os.getenv("SEARCH_API", "duckduckgo").lower()


# ============ 标准化：把各引擎的原始结果统一成同一字段 ============

def _normalize_ddgs(items: list[dict]) -> list[dict]:
    """ddgs 结果标准化为统一字段。

    ddgs 字段是 title/href/body，且没有相关性 score → 按顺序给递减分数，
    让 SearchResultPostProcessor 的排序/过滤工序仍可工作。
    """

    normalized = [ ]

    for i, it in enumerate(items):
        url = it.get("href") or it.get("url") or ""
        body = it.get("body") or it.get("content") or ""
        normalized.append(
            {
                "type": "page",
                "url": url,
                "title": it.get("title") or "",
                "content": body,
                "raw_content": body,
                "score": round(1.0 - i * 0.1, 2),  # 递减分数（模拟相关性）
            }
        )
    return normalized


def _normalize_tavily(items: list[dict]) -> list[dict]:
    """tavily 结果标准化（tavily 自带 score/url/content/raw_content）。"""

    normalized = [ ]

    for it in items:
        normalized.append(
            {
                "type": "page",
                "url": it.get("url") or "",
                "title": it.get("title") or "",
                "content": it.get("content") or "",
                "raw_content": it.get("raw_content") or "",
                "score": float(it.get("score") or 0.0),
            }
        )
    return normalized



# ============ 各引擎原始搜索（失败一律返回 [ ] ，不抛异常）============


def _ddgs_search(query: str, max_results: int) -> list[dict]:
    """同步 DDGS 调用（供 async 版本通过 to_thread 包裹）。"""
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS

    with DDGS() as ddgs:
        items = list(ddgs.text(query, max_results=max_results))
    return items


async def _ddgs_search_async(query: str, max_results: int) -> list[dict]:
    """异步 DDGS 搜索：ddgs 9.14.4 无 AsyncDDGS，用 to_thread 把同步调用丢线程池。"""
    try:
        items = await asyncio.to_thread(_ddgs_search, query, max_results)
        logger.info(f"[search] DuckDuckGo 搜到 {len(items)} 条: {query}")
        return _normalize_ddgs(items)
    except Exception as e:
        logger.warning(f"[search] DuckDuckGo 失败（将降级用 LLM 兜底）: {e}")

        return [ ]



async def _tavily_search_async(query: str, max_results: int) -> list[dict]:

    """异步 Tavily 搜索：优先 AsyncTavilyClient，失败/未装则捕获后返回 []。"""

    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        logger.warning("[search] 已选 Tavily 但未配 TAVILY_API_KEY，跳过")

        return [ ]

    try:
        from tavily import AsyncTavilyClient

        # 域名黑白名单（Tavily 独有能力），从环境变量读
        include_domains = _parse_domains(os.getenv("TAVILY_INCLUDE_DOMAINS", ""))
        exclude_domains = _parse_domains(os.getenv("TAVILY_EXCLUDE_DOMAINS", ""))
        client = AsyncTavilyClient(api_key=api_key)
        resp = await client.search(
            query,
            max_results=max_results,
            include_domains=include_domains or None,
            exclude_domains=exclude_domains or None,
        )

        items = resp.get("results", [])

        logger.info(f"[search] Tavily 搜到 {len(items)} 条: {query}")
        return _normalize_tavily(items)
    except Exception as e:
        logger.warning(f"[search] Tavily 失败（将降级用 LLM 兜底）: {e}")

        return [ ]



def _parse_domains(raw: str) -> list[str]:
    """把逗号分隔的域名串解析成列表。"""
    if not raw:

        return [ ]

    return [d.strip() for d in raw.split(",") if d.strip()]


# ============ 主入口：标准化 + 后处理 ============

async def web_search(query: str, max_results: int = 5, apply_postprocess: bool = True) -> list[dict]:

    """执行搜索，返回标准化结果列表（默认经过后处理清洗）。失败返回 []。


    Args:
        query: 搜索关键词
        max_results: 最大结果数
        apply_postprocess: 是否做 5 道工序后处理（默认 True）
    """
    engine = _get_engine()
    if engine in ("none", "off", ""):
        logger.info("[search] 搜索已禁用（SEARCH_API=none）")

        return [ ]


    if engine == "tavily":
        results = await _tavily_search_async(query, max_results)
    else:
        results = await _ddgs_search_async(query, max_results)

    if apply_postprocess and results:
        processor = SearchResultPostProcessor(
            min_score_threshold=float(os.getenv("SEARCH_MIN_SCORE", "0")),
            max_content_length_per_page=int(
                os.getenv("SEARCH_MAX_CONTENT_LEN", "4000")
            ),
        )
        results = processor.process_results(results)
    return results


def format_search_results(results: list[dict], topic: str, locale: str) -> str:
    """把标准化结果格式化为一段 markdown 观察（喂给 reporter）。"""
    lines = [f"# 关于「{topic}」的检索结果（共 {len(results)} 条）"]
    for i, r in enumerate(results, 1):
        title = r.get("title") or "(无标题)"
        url = r.get("url") or ""
        body = r.get("content") or r.get("raw_content") or ""
        score = r.get("score")
        score_str = f"（相关度 {score}）" if score else ""
        lines.append(f"\n## {i}. {title} {score_str}\n\n- 链接：{url}\n- 摘要：{body}\n")
    return "\n".join(lines)


# ============ 三种封装之（二）BaseTool 子类 + （三）create_logged_tool 工厂 ============

class _WebSearchInput(BaseModel):
    """web_search 工具的参数 schema（显式定义，确保 bind_tools 正确传递给 LLM）。"""

    query: str = Field(..., description="搜索关键词，如 'LangGraph 架构'")


def _coerce_query(query: str, kwargs: dict) -> str:
    """从工具调用参数里提取 query，兼容多种格式。

    部分模型（如 Qwen3）的 tool call 会把参数包在 kwargs 里，如：
        {"kwargs": {"query": "..."}} 或 {"kwargs": "..."}
    这里做统一兜底提取，避免 BaseTool 因参数名不匹配而报错。
    """
    if query:
        return query
    kw = kwargs.get("kwargs") if kwargs else None
    if isinstance(kw, dict):
        return kw.get("query") or ""
    if isinstance(kw, str):
        return kw
    if isinstance(kw, list) and kw:
        return str(kw[0])
    if kwargs:
        return next((v for v in kwargs.values() if isinstance(v, str)), "")
    return ""


class WebSearchTool(BaseTool):
    """BaseTool 子类封装：把 web_search 函数包装成 LangChain 工具。

    适合需要持有状态（如 max_results）、自定义描述、被 ReAct agent 调用的场景。
    """

    name: str = "web_search"
    description: str = (
        "Search the web for current information. "
        "用途：联网搜索关键词，返回经过去重/过滤/截断清洗的结构化结果。"
    )
    args_schema: type[BaseModel] = _WebSearchInput  # 显式参数 schema，确保 bind_tools 正确传给 LLM
    max_results: int = 5

    def _run(self, query: str = "", **kwargs) -> list[dict]:
        query = _coerce_query(query, kwargs)
        if not query:

            return [ ]

        # web_search 已 async 化，同步入口用 asyncio.run 兜底（避免遗漏的同步调用点崩溃）
        results = asyncio.run(web_search(query, max_results=self.max_results))
        return results

    async def _arun(self, query: str = "", **kwargs) -> list[dict]:
        # **kwargs 兜底：部分模型（如 Qwen3）的 tool call 会把参数包在 kwargs 里
        query = _coerce_query(query, kwargs)
        if not query:

            return [ ]

        results = await web_search(query, max_results=self.max_results)
        return results


# 工厂封装：给 WebSearchTool 套上输入/输出日志（无需改原类代码）
LoggedWebSearchTool = create_logged_tool(WebSearchTool)


def get_web_search_tool(max_results: int = 5) -> BaseTool:
    """工厂函数：返回带日志的 WebSearchTool 实例（第4章 ReAct agent 用）。"""
    return LoggedWebSearchTool(max_results=max_results)
