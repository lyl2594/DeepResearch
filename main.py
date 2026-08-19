import logging
import argparse
import sys
import os
import asyncio

from langgraph.types import Command
from dotenv import load_dotenv

from graph.builder import graph

if sys.platform == "win32":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("mini_deepresearch")



def _bool_env(key: str, default: str = "false") -> bool:
    """从环境变量中获取布尔值，默认值为 False"""
    return os.getenv(key, default).lower() in ("true", "1" , "yes","on")


def print_state_debug(event: dict):
    
    observations = event.get("observations") or []

    print("\n[debug-state]")
    print(f"research_topic: {event.get('research_topic', '(无)')}")
    print(f"locale: {event.get('locale', '(无)')}")
    print(f"observations_count: {len(observations)}")
    print(f"has_final_report: {bool(event.get('final_report'))}")


def _get_interrupt_value(snap):
    """从图状态快照提取 interrupt 的 value（兼容不同 langgraph 版本）。"""
    for task in snap.tasks:
        if hasattr(task, "interrupts") and task.interrupts:
            return task.interrupts[0].value
    intrs = snap.values.get("__interrupt__") if snap.values else None
    if intrs:
        try:
            return intrs[0].value
        except (AttributeError, IndexError, TypeError):
            return intrs[0] if intrs else None
    return None


def _prompt_interrupt(intr_value: dict) -> str:
    """根据 interrupt 类型提示用户输入反馈。"""
    itype = intr_value.get("type", "") if isinstance(intr_value, dict) else ""
    print("\n" + "=" * 60)
    if itype == "plan_review":
        print("📋 计划审核（HITL）")
        print(intr_value.get("message", ""))
        print("\n计划内容预览：")
        print(str(intr_value.get("content", ""))[:800])
        print("\n输入 [ACCEPTED] 接受 / [EDIT_PLAN] 回规划器重新规划")
    elif itype == "llm_output_review":
        print("📝 报告审核（HITL）")
        print(intr_value.get("message", ""))
        print("\n输入 [ACCEPTED] 接受 / [CONTINUE] 重新生成")
    else:
        print(f"⛔ 中断（{itype}）")
        print(intr_value.get("message", "") if isinstance(intr_value, dict) else str(intr_value))
    print("=" * 60)
    try:
        return input("> ").strip() or "[ACCEPTED]"
    except (EOFError, KeyboardInterrupt):
        return "[ACCEPTED]"



async def run_with_hitl(initial_state, config):
    """带 HITL 的运行循环：跑到 interrupt → 提示用户 → resume → 直到完成。"""
    state = initial_state
    while True:
        last_event = None
        async for event in graph.astream(state, config=config, stream_mode="values"):
            last_event = event

        snap = graph.get_state(config)
        if not snap.next:               # snap.next 为空 = 流程结束（到 END）
            return last_event

        intr_value = _get_interrupt_value(snap)
        if intr_value is None:
            logger.warning("图暂停但未找到 interrupt，结束")
            return last_event

        feedback = _prompt_interrupt(intr_value)
        logger.info(f"[hitl] resume 反馈: {feedback!r}")
        state = Command(resume=feedback)   # ⭐ resume：把反馈喂回 interrupt


async def main():
    load_dotenv()

    args = sys.argv[1:]
    auto = False
    if "--auto" in args:
        auto = True
        args = [a for a in args if a != "--auto"]

    if args:
        question = " ".join(args)
    else:
        question = input("请输入你的研究问题（或闲聊）: ").strip()
        if not question:
            print("问题不能为空")
            return

    logger.info(f"输入: {question}  | HITL={'关闭(--auto)' if auto else '开启'}")

    config = {
        "configurable": {
            "thread_id": "demo-1",          # ⭐ checkpointer 按 thread_id 找会话
            "max_plan_iterations": 2,        # 第5章：允许 [EDIT_PLAN] 回 planner 重规划，故 2
            "max_step_num": 3,
        }
    }
    initial_state = {
        "messages": [{"role": "user", "content": question}],
        "auto_accepted_plan": auto,          # ⭐ --auto → True → 跳过所有 interrupt
    }

    final_state = await run_with_hitl(initial_state, config)

    # 打印计划清单（每步是否完成 + step_type + 标题）
    plan = (final_state or {}).get("current_plan")
    if plan and hasattr(plan, "steps"):
        print("\n" + "=" * 60)
        print(f"研究计划：{plan.title}（{len(plan.steps)} 步）")
        for i, s in enumerate(plan.steps, 1):
            mark = "✓" if s.execution_res else " "
            tag = s.step_type.value if hasattr(s.step_type, "value") else str(s.step_type)
            print(f"  [{mark}] {i}. ({tag}) {s.title}")

    # 打印最终输出
    print("\n" + "=" * 60)
    print("最终输出")
    print("=" * 60 + "\n")
    print((final_state or {}).get("final_report", "（无输出）"))


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())

