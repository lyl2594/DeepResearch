import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from graph.nodes import _execute_agent_step, eval_node
from prompts.planner_model import Plan, Step
from server.app import app
from server.thread_state_manager import thread_state_manager


class SkipContractTests(unittest.TestCase):
    def tearDown(self):
        thread_state_manager.clear("thread-skip-test")

    def test_skip_accepts_frontend_json_body(self):
        client = TestClient(app)

        response = client.post(
            "/api/chat/skip", json={"thread_id": "thread-skip-test"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skip_set"])
        self.assertTrue(thread_state_manager.get_skip_state("thread-skip-test"))

    def test_skip_during_stream_discards_partial_result_and_finishes_current_step(self):
        class FakeAgent:
            async def astream(self, *_args, **_kwargs):
                yield {"messages": [AIMessage(content="partial")]}
                thread_state_manager.set_skip_state("thread-skip-test", True)
                yield {"messages": [AIMessage(content="should be discarded")]}

        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="test",
            steps=[
                Step(
                    need_search=True,
                    title="current",
                    description="current step",
                    step_type="research",
                    execution_res="previous usable result",
                )
            ],
        )

        low_evaluation = {
            "quality_score": 0.4,
            "feedback": "needs more evidence",
        }
        with (
            patch("graph.nodes.get_stream_writer", return_value=lambda _event: None),
            patch(
                "graph.nodes._evaluate_research_step",
                new=AsyncMock(return_value=low_evaluation),
            ),
        ):
            asyncio.run(
                eval_node(
                    {"current_plan": plan, "evaluation_history": []},
                    {
                        "configurable": {
                            "min_quality_score": 0.7,
                            "max_step_iterations": 2,
                        }
                    },
                )
            )

        self.assertIsNone(plan.steps[0].execution_res)
        self.assertEqual(plan.steps[0].last_execution_res, "previous usable result")
        self.assertEqual(plan.steps[0].last_evaluation_result, low_evaluation)

        with patch("graph.nodes._log_node_event"):
            command = asyncio.run(
                _execute_agent_step(
                    # step="step0" 绕过 _execute_agent_step 的哨兵（首次进入会 update step 再回退），
                    # 让本测试专注验证"流式中途 skip 中断"这条路径本身。
                    {"current_plan": plan, "step": "step0"},
                    FakeAgent(),
                    "researcher",
                    {
                        "configurable": {
                            "thread_id": "thread-skip-test",
                            "max_step_iterations": 2,
                        }
                    },
                )
            )

        self.assertEqual(plan.steps[0].execution_res, "previous usable result")
        self.assertEqual(
            plan.steps[0].evaluation_result,
            low_evaluation,
        )
        self.assertEqual(plan.steps[0].step_iterations, 3)
        self.assertFalse(thread_state_manager.get_skip_state("thread-skip-test"))
        self.assertEqual(command.goto, "research_team")
        self.assertNotIn("observations", command.update)


if __name__ == "__main__":
    unittest.main()
