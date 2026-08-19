"""LLM 工厂：按类型获取已配置的 LLM 实例。

简化自 deepResearch 的 src/llms/llm.py，保留三个核心能力：
1. 从 conf.yaml 读取配置
2. 用 .env 中的 BASIC_MODEL__<key> 环境变量覆盖
3. 缓存实例（同类型只创建一次）

后续章节会扩展：REASONING_MODEL（第2章规划）、EVALUATE_MODEL（第6章评估）。
"""
import logging
import os
from pathlib import Path

import yaml
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

# 配置文件路径：code/ 目录下的 conf.yaml
_CONF_PATH = Path(__file__).parent / "conf.yaml"

# LLM 类型 → conf.yaml 里的配置块名
_LLM_TYPE_TO_KEY = {
    "basic": "BASIC_MODEL",
    "reasoning": "REASONING_MODEL",
    "evaluate": "EVALUATE_MODEL",
}

# 实例缓存 + token 上限缓存（第7章 ContextManager 用）
_llm_cache: dict[str, ChatOpenAI] = {}
_token_limits: dict[str, int] = {}


def _load_yaml_config() -> dict:
    """读取 conf.yaml。"""
    if not _CONF_PATH.exists():
        logger.warning(f"配置文件不存在: {_CONF_PATH}")
        return {}
    with open(_CONF_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _get_env_overrides(llm_type: str) -> dict:
    """读取 {LLM_TYPE}_MODEL__<key> 格式的环境变量。

    例如 BASIC_MODEL__api_key、BASIC_MODEL__base_url。
    这些变量会覆盖 conf.yaml 里的同名字段。
    """
    prefix = f"{llm_type.upper()}_MODEL__"
    return {
        k[len(prefix):].lower(): v
        for k, v in os.environ.items()
        if k.startswith(prefix)
    }


def _resolve_config(llm_type: str) -> dict:
    """解析某 LLM 类型的完整构造参数（yaml + .env 覆盖 + 防御性默认值）。"""
    config_key = _LLM_TYPE_TO_KEY.get(llm_type)
    if not config_key:
        raise ValueError(f"未知 LLM 类型: {llm_type}，支持: {list(_LLM_TYPE_TO_KEY)}")

    # yaml 配置 + 环境变量覆盖
    yaml_conf = _load_yaml_config().get(config_key, {})
    merged = {**yaml_conf, **_get_env_overrides(llm_type)}

    # token_limit 不传给 ChatOpenAI，单独缓存（第7章用）
    if "token_limit" in merged:
        _token_limits[llm_type] = int(merged.pop("token_limit"))

    # 防御：api_key 必须是字符串（conf.yaml 里不加引号会被解析成 int）
    if "api_key" in merged:
        merged["api_key"] = str(merged["api_key"])

    # 默认重试 3 次，处理限流
    merged.setdefault("max_retries", 3)
    # 本章可观测增量：LLM 调用超时 60s（防卡死；生产按模型调）
    merged.setdefault("timeout", int(os.getenv("LLM_TIMEOUT", "60")))

    if not merged.get("model"):
        raise ValueError(
            f"LLM 类型 '{llm_type}' 未配置 model，请检查 conf.yaml / .env"
        )
    return merged


def get_llm_by_type(llm_type: str = "basic") -> ChatOpenAI:
    """按类型获取 LLM 实例（带缓存）。"""
    if llm_type in _llm_cache:
        return _llm_cache[llm_type]

    merged = _resolve_config(llm_type)
    llm = ChatOpenAI(**merged)
    _llm_cache[llm_type] = llm
    logger.info(f"已创建 LLM 实例: type={llm_type}, model={merged['model']}")
    return llm


def get_report_llm() -> ChatOpenAI:
    """报告撰写专用 LLM（缓存）：显式关闭 thinking，只输出最终整理好的报告正文。

    原因：Qwen3 等推理模型默认开启思考时，会把"边想边写"的草稿直接混进正文
    （常不带 <thinking>/<thought> 分隔标签，clean_think / think_parser 无法剥离），
    导致最终报告里堆满了过程分析。这里用 extra_body.chat_template_kwargs
    显式关闭思考，保证最终报告 = 唯一一份整理好的完整内容。
    """
    if "report" in _llm_cache:
        return _llm_cache["report"]

    merged = _resolve_config("basic")
    merged.pop("model_kwargs", None)
    merged["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
    llm = ChatOpenAI(**merged)
    _llm_cache["report"] = llm
    logger.info(f"已创建报告 LLM 实例: model={merged['model']}（thinking 已关闭）")
    return llm


def get_llm_token_limit(llm_type: str = "basic") -> int | None:
    """获取该类型 LLM 的 token 上限。第7章 ContextManager 用。"""
    # 若还没创建过实例，先尝试填充
    if llm_type not in _token_limits and llm_type not in _llm_cache:
        try:
            get_llm_by_type(llm_type)
        except Exception:
            return None
    return _token_limits.get(llm_type)
