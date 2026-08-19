"""JSON 修复工具：处理 LLM 输出的脏 JSON。

LLM 常输出带 trailing comma、单引号、缺括号、被 markdown 包裹的 JSON。
所有解析 LLM JSON 输出的地方都应包一层 repair_json_output，再 json.loads。
简化自 deepResearch 的 src/utils/json_utils.py。
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)


def sanitize_args(args: Any) -> str:
    """Sanitize tool call arguments to prevent special character issues.

    直接对齐主项目 reference-source/deer-flow-aw/src/utils/json_utils.py。
    前端 merge-message.ts 会在拼接参数前把这些 HTML 实体还原。
    """
    if not isinstance(args, str):
        return ""
    return (
        args.replace("[", "&#91;")
        .replace("]", "&#93;")
        .replace("{", "&#123;")
        .replace("}", "&#125;")
    )


def repair_json_output(content: str) -> str:
    """修复脏 JSON，返回可被 json.loads 的字符串。"""
    if not content:
        return content
    try:
        from json_repair import repair_json

        return repair_json(content)
    except ImportError:
        logger.warning("json_repair 未安装，回退到简单清理（建议 pip install json-repair）")
        return _simple_clean(content)
    except Exception as e:
        logger.warning(f"JSON 修复失败，返回原文: {e}")
        return content


def _simple_clean(content: str) -> str:
    """无 json_repair 时的兜底：去掉 markdown 代码块包裹。"""
    content = content.strip()
    if content.startswith("```"):
        # 去掉首行 ``` 或 ```json
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content.rsplit("```", 1)[0]
    return content.strip()
