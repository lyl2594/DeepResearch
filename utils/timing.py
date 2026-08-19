"""节点耗时装饰器：横切统计每个 graph 节点的执行时间（业务可观测）。

本章可观测增量：除 LangSmith（SaaS 追踪）外，业务侧用本装饰器记录每节点耗时，
无需外部依赖即可定位慢节点（生产 80% 性能问题来自某个慢节点）。
"""
import asyncio
import functools
import logging
import time
from typing import Callable

logger = logging.getLogger(__name__)


def timed_node(func: Callable) -> Callable:
    """装饰 graph 节点（sync 或 async），统计执行耗时并记录日志。

    用法：在节点函数上加 @timed_node（注意：LangGraph 节点装饰器要在最外层）。
    """

    @functools.wraps(func)
    async def _async_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return await func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    @functools.wraps(func)
    def _sync_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    return _async_wrapper if asyncio.iscoroutinefunction(func) else _sync_wrapper
