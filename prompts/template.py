
import os
from datetime import datetime

from jinja2 import Environment, FileSystemLoader ,select_autoescape

# jinja2 环境: 从 prompts/ 目录 加载 .md 模板
_env = Environment(
    loader=FileSystemLoader(os.path.dirname(__file__)), 
    autoescape=select_autoescape(),
    trim_blocks=True, # 标签后的第一个换行不保留
    lstrip_blocks=True # 标签前导空白去除
    )

def apply_prompt_template(prompt_name: str, state: dict) -> list:
    """渲染指定 prompt，返回 [system_message, ...用户消息]。"""

    # prompt_name: 模板文件名，不包含后缀
    # state: 包含所有状态变量的字典
    # 返回: 包含系统消息和用户消息的列表

    state_vars = {
        "CURRENT_TIME": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        **state
    }

    template = _env.get_template(f"{prompt_name}.md")
    system_prompt = template.render(**state_vars)

    return [{"role": "system", "content": system_prompt}] + state.get("messages", [])
