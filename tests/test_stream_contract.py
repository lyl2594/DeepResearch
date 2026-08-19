import asyncio
import html
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langchain_core.messages import AIMessage, AIMessageChunk
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, ChatStream
from database.repository import list_conversations as query_conversations
from prompts.planner_model import Plan, Step
from server.app import (
    _astream_workflow_generator,
    _create_interrupt_event,
    _process_message_chunk,
    _stream_graph_events,
    delete_conversation,
    get_conversation,
    list_conversations,
)


async def collect_events(generator):
    return [event async for event in generator]


def make_state(**values):
    return SimpleNamespace(values=values)


class StreamContractTests(unittest.TestCase):
    def test_intermediate_text_chunk_has_no_finish_reason(self):
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="片段"), {}, "thread-1", make_state()
                    )
                )
            )

        self.assertEqual(events[0][0], "message_chunk")
        self.assertNotIn("finish_reason", events[0][1])

    def test_message_base_reads_role_step_and_reexecution_from_state(self):
        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="计划",
            steps=[
                Step(
                    need_search=True,
                    title="检索",
                    description="检索资料",
                    step_type="research",
                    step_iterations=2,
                )
            ],
        )
        state = make_state(step="step0", step_title="检索", current_plan=plan)

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="片段"),
                        {"langgraph_node": "researcher"},
                        "thread-1",
                        state,
                    )
                )
            )

        data = events[0][1]
        self.assertEqual(data["role"], "assistant")
        self.assertEqual(data["step"], "step0")
        self.assertEqual(data["step_title"], "检索")
        self.assertEqual(data["additional_info"]["re_execute_times"], 2)
        self.assertEqual(
            data["additional_info"]["activity"],
            {"activity_type": "execute_research", "activity_name": "执行研究"},
        )

    def test_react_subgraph_namespace_is_reported_as_researcher(self):
        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="计划",
            steps=[
                Step(
                    need_search=True,
                    title="研究",
                    description="执行研究",
                    step_type="research",
                    step_iterations=1,
                )
            ],
        )
        state = make_state(step="step0", step_title="研究", current_plan=plan)

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="重试中"),
                        {"langgraph_node": "agent"},
                        "thread-1",
                        state,
                        agent_path=("researcher:react-agent",),
                    )
                )
            )

        data = events[0][1]
        self.assertEqual(data["agent"], "researcher")
        self.assertEqual(data["additional_info"]["re_execute_times"], 1)
        self.assertNotIn("checkpoint_id", data)

    def test_stream_graph_passes_current_state_to_message_processor(self):
        state = make_state(step="step0")

        class FakeGraph:
            async def astream(self, *_args, **_kwargs):
                yield ("root", (AIMessageChunk(content="片段"), {}))

            async def aget_state(self, _config):
                return state

        seen = []

        async def fake_process(
            _chunk, _metadata, _thread_id, current_state, agent_path=()
        ):
            seen.append(current_state)
            if False:
                yield None

        with patch("server.app._process_message_chunk", side_effect=fake_process):
            asyncio.run(
                collect_events(
                    _stream_graph_events(FakeGraph(), {}, {}, "thread-1")
                )
            )

        self.assertEqual(seen, [state])

    def test_eval_internal_chunks_are_not_exposed_as_chat_text(self):
        """对齐主项目：评估器内部 structured-output token 不得作为正文显示。"""
        chunk = AIMessageChunk(content='{"quality_score": 0.95}')
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk,
                        {"langgraph_node": "eval"},
                        "thread-1",
                        make_state(),
                    )
                )
            )

        self.assertEqual(events, [])

    def test_evaluation_messages_forward_and_prefer_message_reexecution_count(self):
        evaluation_data = {
            "step_id": "step-1",
            "step_title": "检索",
            "step_type": "research",
            "quality_score": 0.9,
            "feedback": "很好",
            "evaluation_timestamp": "2026-07-21T00:00:00",
            "evaluator_name": "evaluator",
            "evaluation_status": "completed",
        }
        chunk = AIMessage(
            content="研究步骤评估结果",
            additional_kwargs={
                "evaluation_data": evaluation_data,
                "re_execute_times": 3,
            },
            response_metadata={"finish_reason": "stop"},
        )
        state = make_state(step="step0", step_title="检索")

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            eval_events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk, {"langgraph_node": "eval"}, "thread-1", state
                    )
                )
            )
            final_events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk,
                        {"langgraph_node": "final_report_evaluator"},
                        "thread-1",
                        state,
                    )
                )
            )

        for events in (eval_events, final_events):
            self.assertEqual(events[0][0], "evaluation")
            self.assertEqual(events[0][1]["evaluation_data"], evaluation_data)
            self.assertEqual(
                events[0][1]["additional_info"]["re_execute_times"], 3
            )
            self.assertEqual(events[0][1]["finish_reason"], "stop")

    def test_normal_node_and_reporter_stop_are_not_filtered(self):
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            normal = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="正文"),
                        {"langgraph_node": "researcher"},
                        "thread-1",
                        make_state(),
                    )
                )
            )
            reporter = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(
                            content="完成",
                            response_metadata={"finish_reason": "stop"},
                        ),
                        {"langgraph_node": "reporter"},
                        "thread-1",
                        make_state(),
                    )
                )
            )

        self.assertEqual(normal[0][0], "message_chunk")
        self.assertEqual(reporter[0][0], "message_chunk")
        self.assertEqual(reporter[0][1]["finish_reason"], "stop")

    def test_tool_calls_event_always_includes_chunk_array(self):
        """前端 mergeToolCallMessage 会遍历 tool_call_chunks；缺字段会中断整个 SSE 消费。"""
        chunk = AIMessageChunk(
            content="",
            tool_calls=[
                {
                    "name": "handoff_to_planner",
                    "args": {},
                    "id": "call-1",
                    "type": "tool_call",
                }
            ],
        )
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(chunk, {}, "thread-1", make_state())
                )
            )

        self.assertEqual(events[0][0], "tool_calls")
        self.assertIn("tool_call_chunks", events[0][1])
        self.assertIsInstance(events[0][1]["tool_call_chunks"], list)

    def test_tool_argument_chunks_use_dedicated_event(self):
        """后续工具参数分片必须继续推给前端，否则 finish_reason 到来时 JSON 仍不完整。"""
        chunk = AIMessageChunk(
            content="",
            tool_call_chunks=[
                {
                    "name": None,
                    "args": '比声速"}',
                    "id": None,
                    "index": 0,
                    "type": "tool_call_chunk",
                }
            ],
        )
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(chunk, {}, "thread-1", make_state())
                )
            )

        self.assertEqual(events[0][0], "tool_call_chunks")
        self.assertEqual(
            events[0][1]["tool_call_chunks"][0]["args"],
            '比声速"&#125;',
        )

    def test_real_tool_chunk_chain_merges_to_parseable_json(self):
        chunks = [
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": "search",
                        "args": '{"query":"光速",',
                        "id": "call-1",
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": None,
                        "args": '"topic":"与声速',
                        "id": None,
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": None,
                        "args": '比较"}',
                        "id": None,
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                response_metadata={"finish_reason": "tool_calls"},
            ),
        ]

        async def run_chain():
            all_events = []
            for chunk in chunks:
                all_events.extend(
                    await collect_events(
                        _process_message_chunk(chunk, {}, "thread-1", make_state())
                    )
                )
            return all_events

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(run_chain())

        args_chunks = []
        for event_type, data in events:
            if event_type in ("tool_calls", "tool_call_chunks"):
                args_chunks.extend(
                    chunk["args"] for chunk in data.get("tool_call_chunks", [])
                )
        parsed = json.loads(html.unescape("".join(args_chunks)))

        self.assertEqual([event[0] for event in events], [
            "tool_calls",
            "tool_call_chunks",
            "tool_call_chunks",
            "message_chunk",
        ])
        self.assertEqual(events[-1][1]["finish_reason"], "tool_calls")
        self.assertEqual(parsed, {"query": "光速", "topic": "与声速比较"})

    def test_interrupt_contract_for_all_review_types_and_empty_namespace(self):
        expected_options = {
            "plan_review": [
                {"text": "修改计划", "value": "edit_plan"},
                {"text": "开始研究", "value": "accepted"},
            ],
            "retriever_review": [
                {"text": "Continue", "value": "continue"},
                {"text": "Reselect Resources", "value": "reselect"},
            ],
            "llm_output_review": [{"text": "Continue", "value": "continue"}],
            "report_review": [
                {"text": "接受报告", "value": "accepted"},
                {"text": "重新生成", "value": "continue"},
            ],
        }
        state = make_state(step="step1", step_title="审核")

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            for node_type, options in expected_options.items():
                interrupt_obj = SimpleNamespace(
                    value={
                        "type": node_type,
                        "message": "请确认",
                        "re_execute_times": 2,
                    },
                    ns=[],
                )
                event_type, data = _create_interrupt_event(
                    "thread-1", {"__interrupt__": [interrupt_obj]}, state
                )
                self.assertEqual(event_type, "interrupt")
                self.assertEqual(data["thread_id"], "thread-1")
                self.assertEqual(data["role"], "assistant")
                self.assertEqual(data["content"], "请确认")
                self.assertEqual(data["node_type"], node_type)
                self.assertEqual(data["finish_reason"], "interrupt")
                self.assertEqual(data["options"], options)
                self.assertTrue(data["id"].startswith("intr--"))
                self.assertEqual(data["step"], "step1")
                self.assertEqual(data["step_title"], "审核")
                self.assertEqual(data["additional_info"], {"re_execute_times": 2})

    def test_resume_command_carries_edited_plan_and_feedback_text(self):
        edited = {"title": "新计划", "steps": [{"title": "新步骤"}]}
        captured = {}

        async def fake_stream(_graph, workflow_input, _config, _thread_id):
            captured["workflow_input"] = workflow_input
            if False:
                yield None

        from server.chat_request import ChatRequest

        request = ChatRequest(
            messages=[{"role": "user", "content": "请把第二步改成对比实验"}],
            thread_id="thread-1",
            interrupt_feedback="edit_plan",
            plan=edited,
        )
        with (
            patch("server.app._make_event"),
            patch("server.app._stream_graph_events", side_effect=fake_stream),
        ):
            asyncio.run(collect_events(_astream_workflow_generator(request, "thread-1")))

        command = captured["workflow_input"]
        self.assertEqual(command.resume, "[edit_plan] 请把第二步改成对比实验")
        self.assertEqual(command.update["edited_plan"], edited)

    def test_conversation_list_uses_data_envelope(self):
        db = object()
        with patch(
            "server.app.repository.list_conversations",
            return_value=[{"thread_id": "thread-1"}],
        ):
            response = list_conversations(db)

        self.assertEqual(response, {"data": [{"thread_id": "thread-1"}]})

    def test_conversation_list_matches_frontend_contract(self):
        """沿用 ch08 实现后，仍要满足 ConversationsDialog 所需六字段。"""
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()
        try:
            db.add_all(
                [
                    ChatStream(
                        thread_id="thread-1",
                        event_type="message_chunk",
                        content=json.dumps(
                            {"role": "user", "content": "请调研光速与声速"},
                            ensure_ascii=False,
                        ),
                    ),
                    ChatStream(
                        thread_id="thread-1",
                        event_type="message_chunk",
                        content=json.dumps(
                            {"role": "assistant", "content": "开始"},
                            ensure_ascii=False,
                        ),
                    ),
                ]
            )
            db.commit()

            conversations = query_conversations(db)
        finally:
            db.close()

        self.assertEqual(len(conversations), 1)
        item = conversations[0]
        self.assertEqual(item["id"], "thread-1")
        self.assertEqual(item["title"], "请调研光速与声速")
        self.assertEqual(item["count"], 2)
        self.assertEqual(item["category"], "research")
        self.assertEqual(item["data_type"], "chat")
        self.assertIsNotNone(item["date"])

    def test_conversation_list_falls_back_when_first_frame_is_scalar_json(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()
        try:
            db.add(
                ChatStream(
                    thread_id="thread-scalar",
                    event_type="message_chunk",
                    content=json.dumps("valid scalar"),
                )
            )
            db.commit()

            conversations = query_conversations(db)
        finally:
            db.close()

        self.assertEqual(conversations[0]["title"], "thread-scalar")

    def test_delete_conversation_clears_checkpoint_and_returns_contract(self):
        db = object()
        with (
            patch(
                "server.app.graph.checkpointer.adelete_thread",
                new_callable=unittest.mock.AsyncMock,
            ) as delete_checkpoint,
            patch(
                "server.app.repository.delete_conversation",
                return_value=2,
            ) as delete_streams,
        ):
            response = asyncio.run(delete_conversation("thread-1", db))

        delete_checkpoint.assert_awaited_once_with("thread-1")
        delete_streams.assert_called_once_with(db, "thread-1")
        self.assertEqual(
            response,
            {
                "thread_id": "thread-1",
                "deleted": True,
                "message": "Conversation deleted successfully",
            },
        )

    def test_conversation_history_is_replayable_sse_text(self):
        db = object()
        rows = [
            {
                "event_type": "message_chunk",
                "content": json.dumps({"content": "hello"}),
                "finish_reason": "",
            }
        ]
        with patch("server.app.repository.get_conversation", return_value=rows):
            response = get_conversation("thread-1", db)

        self.assertTrue(response.media_type.startswith("text/plain"))
        self.assertEqual(
            response.body.decode(),
            'event: message_chunk\ndata: {"content": "hello"}\n\n',
        )


if __name__ == "__main__":
    unittest.main()
