from pydantic import BaseModel

class ThreadData(BaseModel):
    """单线程的控制状态。"""
    should_skip: bool = False
    report_interrupted: bool = False

class ThreadStateManager:
    """线程状态管理器（进程内单例）。"""
    def __init__(self):
        self._states: dict[str, ThreadData] = {}

    def _init(self, thread_id: str) -> None:
        if thread_id not in self._states:
            self._states[thread_id] = ThreadData()

    def set_skip_state(self, thread_id: str, should_skip: bool = True) -> None:
        self._init(thread_id)
        self._states[thread_id].should_skip = should_skip

    def get_skip_state(self, thread_id: str) -> bool:
        return self._states.get(thread_id, ThreadData()).should_skip

    def clear(self, thread_id: str) -> None:
        self._states.pop(thread_id, None)

# 模块级单例
thread_state_manager = ThreadStateManager()
