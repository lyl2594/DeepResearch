from typing import Any

from pydantic import BaseModel, Field, field_validator


def _normalize_api_url(api_url: str) -> str:
    """规范化 api_url：确保包含协议前缀，移除尾部斜杠。"""
    if not api_url:
        return ""
    # 确保包含协议前缀
    if not api_url.startswith(("http://", "https://")):
        api_url = f"http://{api_url}"
    # 移除尾部斜杠
    return api_url.rstrip("/")


class RAGConfigPayload(BaseModel):
    """知识库配置的可验证输入。"""

    name: str = Field(min_length=1)
    platform: str = Field(min_length=1)
    api_url: str = ""
    ext_config: dict[str, Any] = Field(default_factory=dict)
    retrieval_size: int = Field(default=5, ge=1, le=100)
    similarity: float = Field(default=0.5, ge=0.0, le=1.0)
    is_enabled: bool = True

    @field_validator("api_url")
    def validate_api_url(cls, v):
        return _normalize_api_url(v)


class RAGConnectionPayload(BaseModel):
    platform: str = Field(min_length=1)
    api_url: str = ""
    ext_config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("api_url")
    def validate_api_url(cls, v):
        return _normalize_api_url(v)
