import unittest
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage
from langgraph.graph.message import REMOVE_ALL_MESSAGES

from graph.nodes import make_context_manager_hook
from utils.context_manager import ContextManager
from utils.think_parser import ThinkContentParser


class ContextManagerTests(unittest.TestCase):
    def test_hook_replaces_messages_instead_of_appending_history(self):
        with patch("graph.nodes.get_llm_token_limit", return_value=20):
            hook = make_context_manager_hook("test", preserve=1)

        update = hook(
            {
                "messages": [
                    HumanMessage(content="保留输入"),
                    AIMessage(content="很长的历史" * 30),
                    HumanMessage(content="当前问题"),
                ]
            }
        )

        self.assertIsInstance(update["messages"][0], RemoveMessage)
        self.assertEqual(update["messages"][0].id, REMOVE_ALL_MESSAGES)

    def test_compressed_messages_never_exceed_limit(self):
        messages = [
            HumanMessage(content="中文前缀" * 30),
            AIMessage(content="ASCII history " * 100),
        ]
        manager = ContextManager(token_limit=50, preserve_prefix_message_count=1)

        compressed = manager.compress_messages({"messages": messages})["messages"]

        self.assertLessEqual(manager.count_tokens(compressed), 50)

    def test_tool_call_and_tool_result_are_never_split(self):
        call = AIMessage(
            content="",
            tool_calls=[
                {"name": "search", "args": {"query": "test"}, "id": "call-1", "type": "tool_call"}
            ],
        )
        result = ToolMessage(content="result", tool_call_id="call-1")
        manager = ContextManager(
            token_limit=manager_token_count(result),
            preserve_prefix_message_count=0,
        )

        compressed = manager.compress_messages({"messages": [call, result]})["messages"]

        self.assertEqual(compressed, [])


def manager_token_count(message):
    manager = ContextManager(token_limit=10_000)
    return manager.count_tokens([message])


class ThinkContentParserTests(unittest.TestCase):
    def test_split_tags_are_buffered_across_chunks(self):
        parser = ThinkContentParser()
        chunks = ["开头<thi", "nk>秘密</thi", "nk>正文"]

        outputs = [parser.process_chunk(chunk) for chunk in chunks]
        clean = "".join(item[0] for item in outputs)
        think = "".join(item[1] or "" for item in outputs)

        self.assertEqual(clean, "开头正文")
        self.assertEqual(think, "秘密")

    def test_parser_instances_do_not_share_stream_state(self):
        first = ThinkContentParser()
        second = ThinkContentParser()

        first.process_chunk("<think>秘密")

        self.assertEqual(second.process_chunk("普通正文"), ("普通正文", None))


if __name__ == "__main__":
    unittest.main()
