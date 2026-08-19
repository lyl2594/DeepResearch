import asyncio
import functools
import inspect
import logging
from typing import Callable,Any,TypeVar,Type

logger = logging.getLogger(__name__)

T = TypeVar("T")

def log_io(func: Callable) -> Callable:
    """函数式工具的日志装饰器：记录工具的 入参 和 返回值。支持 async/sync 双分流。"""
    
    if inspect.iscoroutinefunction(func):
        @functools.wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            func_name = func.__name__
            params = ", ".join(
                [*(str(arg) for arg in args), *(f"{k}={v}" for k, v in kwargs.items())]
            )
            logger.info(f"[tool] {func_name} 调用，参数: {params}")

            result = await func(*args, **kwargs)
            
            result_preview = str(result)
            if len(result_preview) > 500:
                result_preview = result_preview[:500] + "..."
            logger.info(f"[tool] {func_name} 返回: {result_preview}")

            return result
        return async_wrapper
    else:
        @functools.wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            func_name = func.__name__
            params = ", ".join(
                [*(str(arg) for arg in args), *(f"{k}={v}" for k, v in kwargs.items())]
            )
            logger.info(f"[tool] {func_name} 调用，参数: {params}")

            result = func(*args, **kwargs)
            
            result_preview = str(result)
            if len(result_preview) > 500:
                result_preview = result_preview[:500] + "..."
            logger.info(f"[tool] {func_name} 返回: {result_preview}")

            return result
        return sync_wrapper





class LoggedToolMixin:
    """Mixin 类：给 BaseTool 子类的 _run 套上日志"""

    def _log_operation(self, method_name: str, *args: Any, **kwargs: Any) -> None:
        # 去掉类名的 "Logged" 前缀，让日志显示原始名称
        tool_name = self.__class__.__name__.replace("Logged", "")
        # 格式化参数：将 args 和 kwargs 拼接为字符串
        params = ", ".join(
            [*(str(arg) for arg in args), *(f"{k}={v}" for k, v in kwargs.items())]
        )
        logger.debug(f"[tool] {tool_name}.{method_name} 调用，参数: {params}")

    def _run(self, *args: Any, **kwargs: Any):
        # 1. 前置日志
        self._log_operation("_run", *args, **kwargs)
        # 2. 调用真正的父类（即原始工具类）逻辑
        result = super()._run(*args, **kwargs)
        # 3. 后置日志
        logger.debug(f"[tool] {self.__class__.__name__.replace('Logged', '')} 返回: {result}")
        return result


def create_logged_tool(base_tool_class: Type[T]) -> Type[T]:
    """工厂函数：动态生成带日志的工具子类"""
    
    # 动态创建一个新类，同时继承 Mixin（日志）和原始类（业务）
    class LoggedTool(LoggedToolMixin, base_tool_class):
        pass
    
    # 重命名新类，便于调试时识别
    LoggedTool.__name__ = f"Logged{base_tool_class.__name__}"
    return LoggedTool


if __name__ == "__main__":

    logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

    from langchain_core.tools import BaseTool
    class EchoTool(BaseTool):
        name: str = "echo"
        description: str = "回显输入文本，用于演示工具日志装饰器。"

        def _run(self, query: str) -> str:
            return f"结果：{query}"

    LoggedEchoTool = create_logged_tool(EchoTool)
    logged_tool = LoggedEchoTool()
    logged_tool._run("你好")
    print(LoggedEchoTool.__name__)
