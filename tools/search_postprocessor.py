
# 1. url 去重
# 2. 低分结果过滤
# 3. base64 图片清洗
# 4. 长度截断
# 5. 按分数降序排序

import logging
import re
from typing import Dict,List

logger = logging.getLogger(__name__)

class SearchResultPostProcessor:
    base64_pattern = r"data:image/[^;]+;base64,[a-zA-Z0-9+/=]+"

    def __init__(
        self,
        min_score_threshold: float = 0.0,
        max_content_length_per_page: int = 4000,
       
        ):
        self.min_score_threshold = min_score_threshold
        self.max_content_length_per_page = max_content_length_per_page


    def process_results(self,results: List[Dict]) -> List[Dict]:
        """
        对搜索结果进行后处理
        """

        if not results:
            return []

        cleaned_results: List[Dict] = []

        seen_urls: set[str] = set()

        for result in results:

            # 1. url 去重
            cleaned_result = self._remove_duplicated(result,seen_urls)

            if not cleaned_result:
                continue
            
            # 2. 低分结果过滤
            if (
                "page" == cleaned_result.get("type")
                and self.min_score_threshold 
                and self.min_score_threshold > 0
                and cleaned_result.get("score",0) < self.min_score_threshold 
            ):
                continue

            # 3. base64 图片清洗
            
            cleaned_result = self._remove_base64_images(cleaned_result)
            if not cleaned_result:
                continue

            # 4. 长度截断
            if (
                self.max_content_length_per_page
                and self.max_content_length_per_page > 0
            ):
                cleaned_result = self._truncate_long_content(cleaned_result)
                

            if cleaned_result:
                cleaned_results.append(cleaned_result)
            
        sorted_results = sorted(
            cleaned_results,key=lambda x: x.get("score",0),reverse=True
        )

        logger.info(
            f"[postprocess] 搜索后处理: {len(results)} -> {len(sorted_results)} 条"
        )
        return sorted_results


    def _remove_duplicated(self,result: Dict,seen_urls: set) -> Dict:
        """
        移除重复的url
        """
        url = result.get("url",result.get("image_url",""))

        if url and url not in seen_urls:
            seen_urls.add(url)
            return result.copy()
        elif not url:
            return result.copy()
        return {}

    def _remove_base64_images(self,result: Dict) -> Dict:
        """
        移除base64图片
        """
        if "page" == result.get("type"):
            return self._process_page(result)
        elif "image" == result.get("type"):
            return self._process_image(result)
        return result.copy()

    def _process_page(self,result: Dict) -> Dict:
        """
        清洗 page 类型里的 base64 （content/raw_content）
        """
        cleaned_result = result.copy()

        if "content" in result and isinstance(result["content"], str):
            original = result["content"]
            cleaned = re.sub(self.base64_pattern," ",original)
            cleaned_result["content"] = cleaned
            if len(cleaned) < len(original) * 0.8:
                logger.debug(
                    f"[postprocess] 清洗掉大量 base64 图片：{result.get('url','unknown')}"
                )
            
        if "raw_content" in cleaned_result and isinstance(cleaned_result["raw_content"], str):
            original = cleaned_result["raw_content"]
            cleaned = re.sub(self.base64_pattern," ",original)
            cleaned_result["raw_content"] = cleaned
        
        return cleaned_result

    def _process_image(self,result: Dict) -> Dict:
        """
        清洗 image 类型里的 base64 (image_url 可能整段是 base64 图片)
        """
        cleaned_result = result.copy()

        if "image_url" in cleaned_result and isinstance(
            cleaned_result["image_url"],str
        ):
            if "data:image" in cleaned_result["image_url"]:
                cleaned = re.sub(self.base64_pattern," ",cleaned_result["image_url"])
                if len(cleaned) == 0 or not cleaned.startswith("http"):
                    return {}
                cleaned_result["image_url"] = cleaned
            
        if "image_description" in cleaned_result and isinstance(
            cleaned_result["image_description"],str
        ):
            if(
                self.max_content_length_per_page
                and len(cleaned_result["image_description"]) > self.max_content_length_per_page
            ):
                cleaned_result["image_description"] = (cleaned_result["image_description"][:self.max_content_length_per_page] + " ..."
            )

        return cleaned_result


    def _truncate_long_content(self, result: Dict) -> Dict:
        """截断超长 content / raw_content。"""
        truncated = result.copy()

        if "content" in truncated and isinstance(truncated["content"], str):
            content = truncated["content"]
            if len(content) > self.max_content_length_per_page:
                truncated["content"] = (
                    content[: self.max_content_length_per_page] + "..."
                )
                logger.info(
                    f"[postprocess] 截断长正文: {result.get('url', 'unknown')}"
                )

        # raw_content 容许略长（含原始 HTML 等），上限翻倍
        if "raw_content" in truncated and isinstance(truncated["raw_content"], str):
            raw = truncated["raw_content"]
            if len(raw) > self.max_content_length_per_page * 2:
                truncated["raw_content"] = (
                    raw[: self.max_content_length_per_page * 2] + "..."
                )

        return truncated
