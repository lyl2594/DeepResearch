"""AIHub 知识库 provider：连接 AIHub 平台进行知识库检索。

移植自 deepResearch src/rag/aihub.py。
5 处适配：
1. rerank: from rag.rerank import get_reranker（懒加载），调用 get_reranker().rerank(query, records)
2. retriever import: from rag.retriever import ...（去 src. 前缀）
3. list API 读 env: DATASET_API_PATH = os.getenv("AIHUB_LIST_RESOURCES_API", "/api/dataset")
4. ddddocr 懒加载：不在顶层 import ddddocr，首次 _parse_captcha 时初始化（ch10 默认未装 ddddocr）
5. AIHubProvider 构造：ch10 Retriever 是纯 ABC（非 BaseModel），字段用 __init__ 参数赋值（参照 MemoryRetriever）
"""
import hashlib
import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, TypeVar
from urllib.parse import urlparse

import requests

from rag.rerank import get_reranker
from rag.retriever import Chunk, Document, Resource, Retriever

logger = logging.getLogger(__name__)

T = TypeVar("T")


class TokenExpiredError(Exception):
    """Exception raised when the token has expired."""

    pass


# ── 全局缓存变量 ──────────────────────────────────────────────
_global_resources_cache_map: dict[str, list[dict]] = {}
_global_cache_timestamp_map: dict[str, float] = {}
_global_cache_lock = threading.Lock()

_global_api_token = None
_global_token_expires_at = None

RESOURCE_CACHE_DUTATION = 10  # resources 资源列表缓存超时时间，默认缓存 10 秒
TOKEN_DURATION = int(os.getenv("AIHUB_TOKEN_DURATION", 60 * 60))
# 知识库 UI 路径
DATASET_UI_PATH = "/ui/dataset"
# 知识库 API 路径（适配点 3：从环境变量读取）
DATASET_API_PATH = os.getenv("AIHUB_LIST_RESOURCES_API", "/api/dataset")

# 适配点 4：ddddocr 懒加载（不在顶层 import）
_ocr_instance = None


def _get_ocr():
    """获取 ddddocr 实例（懒加载，首次调用时才 import 并初始化）。

    ch10 默认环境未装 ddddocr（optional extras），
    只有真正需要验证码识别时（uv run --extra aihub）才触发此 import。
    """
    global _ocr_instance
    if _ocr_instance is None:
        import ddddocr

        _ocr_instance = ddddocr.DdddOcr()
    return _ocr_instance


# 使用 RLock 替代 Lock 以支持重入
_token_lock = threading.RLock()


class AIHubProvider(Retriever):
    """AIHub 知识库 provider：连接 AIHub 平台进行检索。"""

    # 适配点 5：ch10 Retriever 是纯 ABC（非 BaseModel），
    # 字段用 __init__ 参数赋值（参照 MemoryRetriever 的写法）。

    def __init__(
        self,
        rag_platform_id: str = "",
        api_url: str = "",
        username: str = "",
        password: str = "",
        retrieval_size: int = 10,
        similarity: float = 0.4,
        retriever_keyword: str = "",
    ):
        self.rag_platform_id = rag_platform_id
        # 规范化 api_url：确保包含协议前缀，避免 requests 库抛出 InvalidSchema 错误
        if api_url and not api_url.startswith(("http://", "https://")):
            api_url = f"http://{api_url}"
        # 移除尾部斜杠，防止与 endpoint 拼接时产生双斜杠
        self.api_url = api_url.rstrip("/")
        self.username = username
        self.password = password
        self.retrieval_size = retrieval_size
        self.similarity = similarity
        self.retriever_keyword = retriever_keyword

        logger.info(
            f"AIHubProvider initialized - Username: {username}, API URL: {self.api_url}, Password source: {'env' if password else 'default'}"
        )

    def _parse_captcha(self, captcha_image_url: str) -> str:
        """Parse the captcha image and return the response string.

        This method downloads the captcha image and uses OCR to extract the text.
        Falls back to pattern matching and default values if OCR fails.

        Args:
            captcha_image_url: URL of the captcha image.

        Returns:
            str: Response string.
        """
        try:
            # 下载验证码图片
            response = requests.get(captcha_image_url, timeout=10)
            response.raise_for_status()

            # 首次调用时懒加载 ddddocr
            ocr = _get_ocr()

            # 首先尝试使用 OCR 识别验证码图片
            captcha_text = ocr.classification(response.content)

            if captcha_text:
                return str(captcha_text)

            # 如果以上方法都失败，返回默认值
            logger.warning("无法自动识别验证码，使用默认值")
            return "8888"  # 默认值，某些测试环境可能接受

        except Exception as e:
            logger.error(f"验证码识别失败: {str(e)}")
            # 返回默认值作为后备方案
            return "8888"

    def _log_in(self) -> None:
        """Log in and update the token with expiration time."""
        # 先请求验证码
        # response = requests.request(
        #     method="get",
        #     url=f"{self.api_url}/api/user/captcha/refresh",
        #     headers={"Content-Type": "application/json"},
        #     json={"username": self.username, "password": self.password},
        # )
        
        # # 检查响应内容
        # if not response.text.strip():
        #     logger.error(f"[_log_in] 验证码接口响应为空: {self.api_url}/api/user/captcha/refresh")
        #     raise Exception("Captcha API response is empty")
        
        # try:
        #     result = response.json()
        # except ValueError as e:
        #     logger.error(f"[_log_in] 验证码接口 JSON 解析失败")
        #     logger.error(f"[_log_in] 响应内容: {response}")
        #     raise Exception(f"Captcha JSON decode error: {str(e)}")
        
        # captcha_hashkey = (result.get("data") or {}).get("captcha_hashkey")
        # captcha_image_url = (result.get("data") or {}).get("captcha_image")
        # 解析验证码


        # 1. 去掉 json=，改成 params=（GET请求传参的标准方式）
        params = {
            "username": self.username
            # 注意：绝大多数规范接口，获取验证码不需要 password，只传 username 即可
        }

        # 2. 必须加上浏览器请求头，否则依然容易被风控识别为脚本
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            # Referer 填你登录页面的地址，很多接口校验这个
            "Referer": f"{self.api_url}/login"  
        }

        # 3. 正确的GET请求（不带请求体）
        response = requests.request(
            method="GET",
            url=f"{self.api_url}/api/user/captcha/refresh",
            headers=headers,
            params=params,  # 这里改成 params
            timeout=10
        )

        # 后面的 JSON 解析和提取代码保持原样即可
        try:
            result = response.json()
        except ValueError as e:
            logger.error(f"[_log_in] 验证码接口 JSON 解析失败")
            logger.error(f"[_log_in] 响应状态码: {response.status_code}, 响应内容前200字符: {response.text[:200]}")
            raise Exception(f"Captcha JSON decode error: {str(e)}")

        captcha_hashkey = (result.get("data") or {}).get("captcha_hashkey")
        captcha_image_url = (result.get("data") or {}).get("captcha_image")

        # 建议打印一下图片地址，手动复制到浏览器看验证码长什么样
        print(f"验证码图片地址: {captcha_image_url}")

        captcha_response = self._parse_captcha(captcha_image_url)

        result = self._make_request(
            method="post",
            endpoint="/api/user/login",
            json={
                "username": self.username,
                "password": self.password,
                "captcha_hashkey": captcha_hashkey,
                "captcha_response": captcha_response,
            },
        )
        logger.info(f"登录结果: {result}")
        logger.info(
            f"captcha_image_url: {captcha_image_url}, captcha_response: {captcha_response}"
        )
        global _global_api_token, _global_token_expires_at
        with _token_lock:
            _global_api_token = (result.get("data") or {}).get("token")
            # 假设 token 默认 1 小时过期，实际应该从响应中获取
            _global_token_expires_at = datetime.now() + timedelta(
                seconds=TOKEN_DURATION
            )

    def refresh_token(self) -> None:
        """Refresh the authentication token."""
        # 更新 token
        self._log_in()

    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        query_text = self.retriever_keyword if self.retriever_keyword else query
        logger.info(f"-----------------similarity:{self.similarity}")
        logger.info(f"-----------------query_text:{query_text}")
        resources_url = self.api_url.strip("/") + DATASET_UI_PATH
        all_documents: dict[str, Document] = {}

        # 如果没有传入资源，自动获取 AIHub 上的所有资源
        if not resources:
            logger.info("[query_relevant_documents] 未传入资源，自动获取 AIHub 资源列表")
            resources = self.list_resources()

        logger.info(f"[query_relevant_documents] 使用 {len(resources)} 个资源进行检索")

        for resource in resources:
            if resource.rag_platform_id != self.rag_platform_id:
                logger.debug(f"Resource {resource.uri} is not from AIHub, skip it.")
                continue
            dataset_id, _ = parse_uri(resource.uri)
            result = self._make_request(
                method="get",
                endpoint=(
                    f"/api/dataset/{dataset_id}/hit_test?"
                    f"query_text={query_text}&"
                    f"similarity={str(self.similarity)}&"
                    f"top_number={self.retrieval_size}&"
                    f"search_mode=embedding"
                ),
                params={},
            )
            records = result.get("data") or {}

            if not isinstance(records, list):
                logger.warning(f"API返回的data不是列表，跳过处理: {records}")
                continue

            # 适配点 1：get_reranker().rerank(query, records)
            # 如果 rerank 服务不可用，直接返回原始记录
            try:
                records = get_reranker().rerank(query_text, records)
            except Exception as e:
                logger.warning(f"[query_relevant_documents] rerank 服务调用失败: {e}，使用原始排序")

            for record in records:
                doc_id = record.get("document_id", "")
                if doc_id not in all_documents:
                    all_documents[doc_id] = Document(
                        id=doc_id,
                        title=record.get("document_name"),
                        rag_platform_id=self.rag_platform_id,

                        chunks=[],

                        resource_title=resource.title,
                        url=f"{resources_url}/{dataset_id}/{doc_id}?name={resource.title}&readonly=true",
                        authorization=_global_api_token,
                    )

                chunk = Chunk(
                    content=record.get("content", ""),
                    similarity=record.get("similarity", 0.0),
                )
                all_documents[doc_id].chunks.append(chunk)
        return list[Document](all_documents.values())

    def _cache_key(self, query: str | None) -> str:
        ident = getattr(self, "username", None) or getattr(self, "api_key", None) or ""
        raw = f"{self.api_url}|{ident}|{query or ''}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def list_resources(
        self, query: str | None = None, use_cache: bool = True
    ) -> list[Resource]:
        global _global_resources_cache_map, _global_cache_timestamp_map, _global_cache_lock

        current_time = time.time()
        cache_key = self._cache_key(query)
        with _global_cache_lock:
            cached_resources = None

            if use_cache:
                ts = _global_cache_timestamp_map.get(cache_key)
                cache = _global_resources_cache_map.get(cache_key)

                if ts is not None and cache is not None and (current_time - ts <= RESOURCE_CACHE_DUTATION):
                    cached_resources = cache
                    logger.info(f"使用缓存数据: {len(cached_resources)} 条记录")

            if cached_resources is None:
                params = {"name": query} if query else {}
                logger.info(f"获取知识库数据: {params}, 缓存过期或不存在")
                logger.info(f"-----------------list_resources_api:{DATASET_API_PATH}")
                try:
                    result = self._make_request(method="get", endpoint=DATASET_API_PATH, params=params)
                except Exception as e:
                    logger.exception("获取知识库列表失败")
                    raise


                cached_resources = result.get("data") or [ ]

                _global_resources_cache_map[cache_key] = cached_resources
                _global_cache_timestamp_map[cache_key] = current_time
                logger.info(f"更新全局缓存: {len(cached_resources)} 条记录")

        # 构建 Resource 对象列表

        resources = [ ]

        for item in cached_resources:
            resource = Resource(
                rag_platform_id=self.rag_platform_id,
                uri=f"rag://dataset/{item.get('id')}",
                # 确保字段总是字符串类型，即使 API 返回 None
                title=item.get("name") or "",
                description=item.get("desc") or "",
                tag=item.get("tag_name") or "",
            )
            # 如果有查询条件，进行过滤
            if not query or query in item.get("name", ""):
                resources.append(resource)

        return resources

    def test_connection(self) -> dict:
        global _global_api_token, _global_token_expires_at

        try:
            logger.info(f"[test_connection] api_url={self.api_url}, username={self.username}")
            with _token_lock:
                _global_api_token = None
                _global_token_expires_at = None

            self._log_in()
            resources = self.list_resources(use_cache=False)

            return {
                "success": True,
                "resource_count": len(resources),
                "message": "AIHub knowledge base connected successfully",
            }

        except Exception as e:
            return {
                "success": False,
                "resource_count": 0,
                "message": f"{type(e).__name__}: {e}",
            }

    def _get_valid_token(self) -> str:
        """获取有效的 token，如果过期则刷新"""
        global _global_api_token, _global_token_expires_at
        with _token_lock:
            now = datetime.now()
            # 检查 token 是否有效：无 token、无过期时间、或已过期
            if (
                not _global_api_token
                or not _global_token_expires_at
                or now >= _global_token_expires_at
            ):
                self._log_in()
            return _global_api_token

    def _make_request(
        self, method: str, endpoint: str, max_retries: int = 5, **kwargs
    ) -> Dict[str, Any]:
        """Make an HTTP request with token refresh and retry logic.

        Args:
            method: HTTP method (get, post, etc.)
            endpoint: API endpoint to call
            max_retries: Maximum number of retries on token expiration
            **kwargs: Additional arguments to pass to requests.request

        Returns:
            The JSON response as a dictionary

        Raises:
            Exception: If the request fails after all retries
        """
        global _global_api_token, _global_token_expires_at
        headers = kwargs.pop("headers", {})

        for attempt in range(max_retries + 1):
            try:
                # 对于登录接口，不需要添加 Authorization 头
                if endpoint != "/api/user/login":
                    token = self._get_valid_token()
                    headers["Authorization"] = f"{token}"
                headers.setdefault("Content-Type", "application/json")

                response = requests.request(
                    method=method,
                    url=f"{self.api_url}{endpoint}",
                    headers=headers,
                    **kwargs,
                )

                # 修改 _make_request 方法中的检查逻辑
                if response.status_code == 200:
                    # 检查响应内容是否为空或非 JSON
                    if not response.text.strip():
                        logger.error(f"[_make_request] 响应内容为空: {self.api_url}{endpoint}")
                        raise Exception("API response is empty")
                    try:
                        return response.json()
                    except ValueError as e:
                        logger.error(f"[_make_request] JSON 解析失败: {self.api_url}{endpoint}")
                        logger.error(f"[_make_request] 响应内容: {response.text[:200]}")
                        raise Exception(f"JSON decode error: {str(e)}")
                elif response.status_code == 401:
                    try:
                        response_data = response.json()
                    except ValueError:
                        logger.error(f"[_make_request] 401 响应 JSON 解析失败: {response.text[:200]}")
                        response_data = {}
                    logger.error(f"[_make_request] 401 未授权: {self.api_url}{endpoint}, code={response_data.get('code')}, attempt={attempt}/{max_retries}")
                    # 任何 401 都刷新 token 并重试，不仅仅是 code == 1002
                    if attempt < max_retries:
                        with _token_lock:
                            _global_api_token = None
                            _global_token_expires_at = None
                        continue
                    else:
                        # 重试用尽，抛出异常而不是静默返回
                        raise Exception(f"API 请求 401 未授权，重试 {max_retries} 次后仍然失败: {response_data}")
                else:
                    response.raise_for_status()

            except Exception as e:
                if attempt == max_retries:
                    raise Exception(
                        f"API request failed after {max_retries} retries: {str(e)}"
                    )
                # 请求异常时，更新 token
                self.refresh_token()
                time.sleep(1)  # Simple backoff

        # 如果所有重试都失败，返回空的字典
        return {}


def parse_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "rag":
        raise ValueError(f"Invalid URI: {uri}")
    return parsed.path.split("/")[1], parsed.fragment
