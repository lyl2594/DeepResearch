import { parse } from "best-effort-json-parser";

export function parseJSON<T>(json: string | null | undefined | any, fallback: T) {
  if (!json) {
    return fallback;
  }
  // 确保 json 是字符串类型
  const jsonStr = typeof json !== 'string' ? String(json) : json;
  try {
    const raw = jsonStr
      .trim()
      .replace(/[\s\S]*```json\s*/, "")
      .replace(/^```js\s*/, "")
      .replace(/^```ts\s*/, "")
      .replace(/^```plaintext\s*/, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "");
    // 当前调用点只消费 JSON 对象/数组。工具的纯文本结果
    // （例如“未搜到……”）直接回退，不交给 best-effort parser 拆分。
    if (!raw.startsWith("{") && !raw.startsWith("[")) {
      return fallback;
    }
    try {
      return parse(raw) as T;
    } catch (parseError) {
      console.error('Failed to parse JSON:', {
        error: parseError,
        originalContent: jsonStr,
        cleanedContent: raw
      });
      return fallback;
    }
  } catch (error) {
    console.error('Error while processing JSON string:', {
      error,
      originalContent: jsonStr
    });
    return fallback;
  }
}
