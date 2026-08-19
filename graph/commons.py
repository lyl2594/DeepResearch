import re
from prompts.planner_model import Plan, Step

def clean_think(text: str) -> str:
    
    if not text:
        return text
    return re.sub(r"<think>.*?</think>", "", text ,flags=re.DOTALL).strip()
   

def get_current_step(current_plan) -> Step | None:
    """
    找到第一个未完成 （execution_res 为空 ） 的 step

    用于 researcher 找到当前执行的步骤 ，也用于 research_team 路由判断
    """
    if not current_plan or not isinstance(current_plan, Plan):
        return None
    for step in current_plan.steps:
        if not step.execution_res:
            return step
    return None



