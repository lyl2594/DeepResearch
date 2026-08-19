"""流式 think 状态机：跨 chunk 解析 <think>...</think> 标签。

参考 deepResearch 的 src/utils/think_parser.py（直接移植）。

为什么需要：Qwen3 等推理模型流式输出时，<think>...</think> 可能跨多个 chunk 到达
（如 chunk1="<think>思考"，chunk2="过程</think>正文"）。简单的 clean_think（正则）只能处理
完整文本，流式场景需状态机记住"当前是否在 think 标签内"，跨 chunk 拼接判断。

第7章作为模块提供；第8章 SSE 流式推给前端时用它分离 think / 正文。
"""
from typing import Optional, Tuple


class ThinkContentParser:
    """单条流专用的 think 解析器，跨 chunk 维持状态。"""

    @classmethod
    def get_instance(cls) -> "ThinkContentParser":
        """兼容旧调用名，但每次返回独立实例，避免并发流串状态。"""
        return cls()

    def __init__(self):
        self.in_think = False
        self._buffer = ""

    def reset(self) -> None:
        """重置状态（新的一轮流式开始时调用）。"""
        self.in_think = False
        self._buffer = ""

    def process_chunk(self, chunk_content) -> Tuple[str, Optional[str]]:
        """处理单个 chunk，返回 (清理后的正文内容, 提取的 think 内容)。

        跨 chunk 维持 in_think 状态：<think> 和 </think> 可能不在同一 chunk。
        """
        # 处理 LLM 返回的多模态格式（列表）
        if isinstance(chunk_content, list):
            chunk_content = "".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in chunk_content
            )
        
        if not chunk_content:
            return "", None

        clean_content = ""
        think_content = ""
        remaining = self._buffer + str(chunk_content)
        self._buffer = ""

        while remaining:
            if not self.in_think:
                # 在正文中：找 <think> 开始
                think_start = remaining.find("<think>")
                if think_start == -1:
                    emitted, self._buffer = self._split_partial_tag(
                        remaining, "<think>"
                    )
                    clean_content += emitted
                    break
                clean_content += remaining[:think_start]
                remaining = remaining[think_start + len("<think>"):]
                self.in_think = True
            else:
                # 在 think 内：找 </think> 结束
                think_end = remaining.find("</think>")
                if think_end == -1:
                    emitted, self._buffer = self._split_partial_tag(
                        remaining, "</think>"
                    )
                    think_content += emitted
                    break
                think_content += remaining[:think_end]
                remaining = remaining[think_end + len("</think>"):]
                self.in_think = False

        return clean_content, (think_content or None)

    @staticmethod
    def _split_partial_tag(text: str, tag: str) -> Tuple[str, str]:
        """保留可能是 tag 前缀的最长尾串，等待下一个 chunk 补全。"""
        max_prefix = min(len(text), len(tag) - 1)
        for size in range(max_prefix, 0, -1):
            if text.endswith(tag[:size]):
                return text[:-size], text[-size:]
        return text, ""

    def flush(self) -> Tuple[str, Optional[str]]:
        """流结束时释放未组成完整标签的缓冲内容。"""
        pending = self._buffer
        self._buffer = ""
        if not pending:
            return "", None
        if self.in_think:
            return "", pending
        return pending, None
