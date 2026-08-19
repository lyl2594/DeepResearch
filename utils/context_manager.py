import copy
import json
import logging
from typing import List
from langchain_core.messages import BaseMessage, AIMessage, SystemMessage, ToolMessage, HumanMessage

logger = logging.getLogger(__name__)

class ContextManager:
    """上下文管理器：超 token_limit 时滑动窗口压缩 messages。"""

    def __init__(self, token_limit: int, preserve_prefix_message_count: int = 0):
        """初始化。

        Args:
            token_limit: token 上限（来自 conf.yaml 的 token_limit；None 则不压缩）
            preserve_prefix_message_count: 压缩时保留开头多少条消息（system/用户输入）
        """
        self.token_limit = token_limit
        self.preserve_prefix_message_count = preserve_prefix_message_count

 

    def count_tokens(self, messages: List[BaseMessage]) -> int:
        """统计消息列表的总 token 数。"""
        return sum(self._count_message_tokens(m) for m in messages)

    def _count_message_tokens(self, message: BaseMessage) -> int:
        """估算单条消息的 token 数（按消息类型加权）。"""
        token_count = 0
        if hasattr(message, "content") and message.content:
            if isinstance(message.content, str):
                token_count += self._count_text_tokens(message.content)

        if hasattr(message, "type"):
            token_count += self._count_text_tokens(message.type)

        # 不同消息类型略加权（AI 含推理、Tool 含结构化数据，token 偏多）
        if isinstance(message, SystemMessage):
            token_count = int(token_count * 1.1)
        elif isinstance(message, AIMessage):
            token_count = int(token_count * 1.2)
        elif isinstance(message, ToolMessage):
            token_count = int(token_count * 1.3)

        if hasattr(message, "additional_kwargs") and message.additional_kwargs:
            token_count += self._count_text_tokens(str(message.additional_kwargs))
            if "tool_calls" in message.additional_kwargs:
                token_count += 50  # 函数调用信息估算

        return max(1, token_count)

    def _count_text_tokens(self, text: str) -> int:
        """文本 token 估算：ASCII 4 字符/token，非 ASCII（中文）1 字符/token。"""
        if not text:
            return 0
        english_chars = sum(1 for ch in text if ord(ch) < 128)
        non_english_chars = len(text) - english_chars
        return english_chars // 4 + non_english_chars

    def is_over_limit(self, messages: List[BaseMessage]) -> bool:
        return self.count_tokens(messages) > self.token_limit

    # ---------- 压缩 ----------

    def compress_messages(self, state: dict) -> dict:
        """pre_model_hook 入口：超限时压缩 messages，返回更新后的 state。

        作为 create_react_agent 的 pre_model_hook 使用：每次 LLM 调用前触发。
        """
        if self.token_limit is None:
            logger.info("[context_manager] 未设 token_limit，上下文管理不生效")
            return state

        if not isinstance(state, dict) or "messages" not in state:
            return state

        messages = state["messages"]
        if not self.is_over_limit(messages):
            return state  # 未超限，原样返回

        compressed = self._compress_messages(messages)
        logger.info(
            f"[context_manager] 压缩: {self.count_tokens(messages)} -> "
            f"{self.count_tokens(compressed)} tokens"
        )
        return {**state, "messages": compressed}

    def _compress_messages(self, messages: List[BaseMessage]) -> List[BaseMessage]:
        """滑动窗口压缩：保前缀 N 条 + 从尾部回填 + 边界截断。

        策略：开头保留 system/用户输入（preserve_prefix），其余从末尾向前保留最近的对话
        （最近的工具结果/思考更重要），超限部分截断。
        """
        available_token = self.token_limit
        units = self._group_tool_messages(messages)

        prefix_messages: List[BaseMessage] = [ ]

        consumed_units = 0
        preserved_count = 0

        # 1. 按完整消息单元保留前缀；工具调用和对应结果永远视为一个原子单元。
        for unit in units:
            if preserved_count >= self.preserve_prefix_message_count:
                break
            unit_tokens = self.count_tokens(unit)
            if unit_tokens <= available_token:
                prefix_messages.extend(unit)
                available_token -= unit_tokens
                preserved_count += len(unit)
                consumed_units += 1
                continue
            if len(unit) == 1 and self._can_truncate(unit[0]):
                truncated = self._truncate_message_content(unit[0], available_token)
                if truncated is not None:
                    prefix_messages.append(truncated)
                return prefix_messages
            return prefix_messages

        # 2. 剩余单元从尾部回填；放不下的工具单元整体丢弃，不制造孤立 ToolMessage。

        suffix_messages: List[BaseMessage] = [ ]

        for unit in reversed(units[consumed_units:]):
            unit_tokens = self.count_tokens(unit)
            if unit_tokens <= available_token:
                suffix_messages = unit + suffix_messages
                available_token -= unit_tokens
                continue
            if available_token > 0 and len(unit) == 1 and self._can_truncate(unit[0]):
                truncated = self._truncate_message_content(unit[0], available_token)
                if truncated is not None:
                    suffix_messages = [truncated] + suffix_messages
                break

        return prefix_messages + suffix_messages

    @staticmethod
    def _can_truncate(message: BaseMessage) -> bool:
        """只有普通文本消息可以截断；工具协议消息必须完整保留或完整丢弃。"""
        return not isinstance(message, ToolMessage) and not (
            isinstance(message, AIMessage) and bool(message.tool_calls)
        )

    def _group_tool_messages(
        self, messages: List[BaseMessage]
    ) -> List[List[BaseMessage]]:
        """把 AI tool-call 与紧随其后的 ToolMessage 组成不可拆分单元。

        不完整的 tool-call 序列和孤立 ToolMessage 直接丢弃，避免把非法消息序列交给模型。
        """

        units: List[List[BaseMessage]] = [ ]

        index = 0
        while index < len(messages):
            message = messages[index]
            if isinstance(message, ToolMessage):
                index += 1
                continue
            if isinstance(message, AIMessage) and message.tool_calls:
                expected_ids = {
                    call.get("id") for call in message.tool_calls if call.get("id")
                }
                unit = [message]
                found_ids = set()
                cursor = index + 1
                while cursor < len(messages) and isinstance(
                    messages[cursor], ToolMessage
                ):
                    tool_message = messages[cursor]
                    if tool_message.tool_call_id in expected_ids:
                        unit.append(tool_message)
                        found_ids.add(tool_message.tool_call_id)
                    cursor += 1
                if expected_ids and found_ids == expected_ids:
                    units.append(unit)
                index = cursor
                continue
            units.append([message])
            index += 1
        return units

    def _truncate_message_content(
        self, message: BaseMessage, max_tokens: int
    ) -> BaseMessage | None:
        """二分截断 content，保证截断后的完整消息不超过 max_tokens。"""
        if max_tokens <= 0 or not isinstance(message.content, str):
            return None

        truncated = copy.deepcopy(message)
        truncated.content = ""
        if self._count_message_tokens(truncated) > max_tokens:
            return None

        low, high = 0, len(message.content)
        while low < high:
            middle = (low + high + 1) // 2
            truncated.content = message.content[:middle]
            if self._count_message_tokens(truncated) <= max_tokens:
                low = middle
            else:
                high = middle - 1
        truncated.content = message.content[:low]
        return truncated

def validate_message_content(messages: List[BaseMessage]) -> List[BaseMessage]:
    """消息内容 7 重校验：确保发给 LLM 的 content 合法，防 OOM/报错。

    企业产品 LLM 输出千奇百怪：None content、list/dict content、非 str、缺 content 字段……
    不校验"上线第一天就 OOM"。本函数逐条兜底：
      1. 缺 content 属性 → 设为空串
      2. content is None → 设为空串
      3. content 是 list → 转 JSON 串
      4. content 是 dict → 转 JSON 串
      5. content 非 str → str()
      6. 处理异常 → ToolMessage 写 error json，其他写错误占位
      7. （以上覆盖所有非合法情况，保证返回的消息 content 恒为 str）
    """

    validated = [ ]

    for i, msg in enumerate(messages):
        try:
            safe_msg = copy.deepcopy(msg)
            if not hasattr(safe_msg, "content"):
                logger.warning(f"[validate] 消息{i}({type(msg).__name__}) 无 content 属性，置空")
                safe_msg.content = ""
            elif safe_msg.content is None:
                logger.warning(f"[validate] 消息{i}({type(msg).__name__}) content 为 None，置空")
                safe_msg.content = ""
            elif isinstance(safe_msg.content, (list, dict)):
                safe_msg.content = json.dumps(safe_msg.content, ensure_ascii=False)
            elif not isinstance(safe_msg.content, str):
                safe_msg.content = str(safe_msg.content)
            validated.append(safe_msg)
        except Exception as e:
            logger.error(f"[validate] 消息{i} 校验异常: {e}")
            if isinstance(msg, ToolMessage):
                msg.content = json.dumps({"error": str(e)}, ensure_ascii=False)
            else:
                msg.content = f"[消息处理出错: {e}]"
            validated.append(msg)
    return validated
