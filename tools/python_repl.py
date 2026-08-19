"""python_repl_tool: Python 代码执行工具 (@tool 函数式 + 安全开关)。

安全要点：执行任意代码有风险，因此默认关闭 (ENABLE_PYTHON_REPL=false)，
必须显式开启才真正执行；关闭时返回提示信息，不报错。
"""

import asyncio
import logging
import os
from typing import Annotated, Optional

from langchain_core.tools import tool
from langchain_experimental.utilities import PythonREPL

from tools.decorators import log_io

logger = logging.getLogger(__name__)


def _is_python_repl_enabled() -> bool:
    """从环境变量读取是否启用 Python REPL（默认关闭）。"""
    env_enabled = os.getenv("ENABLE_PYTHON_REPL", "false").lower()
    return env_enabled in ("true", "1", "yes", "on")


# REPL 懒加载：模块导入时 .env 可能尚未加载 (main.py 先 import 再 load_dotenv)，
# 若在模块级初始化，开关会被误判为关闭，repl 永远是 None。故改为首次执行时才创建。
repl: Optional[PythonREPL] = None


def __get_repl() -> PythonREPL:
    """懒加载 PythonREPL 实例（调用时环境变量已就绪）"""
    global repl
    if repl is None:
        repl = PythonREPL()
    return repl


def _strip_code_blocks(code: str) -> str:
    """去除 markdown 代码块标记（如 ```py 或 ```python）。"""
    if not code:
        return code
    code = code.strip()
    if code.startswith("```"):
        code = code[3:]
        if code.startswith("py") or code.startswith("python"):
            code = code[2:].lstrip() if code.startswith("py") else code[6:].lstrip()
        if code.endswith("```"):
            code = code[:-3]
    return code.strip()


@tool
@log_io
async def python_repl_tool(
    code: Annotated[
        str, "The python code to execute to do further analysis or calculation"
    ],
) -> str:
    """Use this to execute python code and do data analysis or calculation.
    If you want to see the output of a value, you should print it out with `print(...)
    用途：执行 Python 代码做数据分析/计算，结果通过 print 输出。
    """
    # 安全开关：未启用时直接返回提示，不执行
    if not _is_python_repl_enabled():
        msg = "Python REPL 工具未启用（ENABLE_PYTHON_REPL=true），已跳过执行。"
        logger.warning(msg)
        return f"Tool disabled: {msg}"

    if not isinstance(code, str):
        return f"Error executing code:\n```python\n{code}\n```\nError: code 必须是字符串"

    code = _strip_code_blocks(code)

    logger.info(f"python_repl 执行 Python 代码")

    try:
        result = await asyncio.to_thread(__get_repl().run, code)
        # PythonREPL 把异常也以字符串形式返回，检测典型错误模式
        if isinstance(result, str) and ("Error" in result or "Exception" in result):
            logger.error(result)
            return f"Error executing code:\n```python\n{code}\n```\nError: {result}"
    except BaseException as e:
        error_msg = repr(e)
        logger.error(error_msg)
        return f"Error executing code:\n```python\n{code}\n```\nError: {error_msg}"

    return f"Successfully executed:\n```python\n{code}\n```\nStdout: {result}"