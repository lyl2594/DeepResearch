// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { env } from "~/env";

import type { MCPServerMetadata } from "../mcp";
import type { Resource } from "../messages";
import { extractFromSearchParams } from "../replay/get-replay-id";
import { fetchStream } from "../sse";
import { sleep } from "../utils";

import { queryConversationByPath } from "./conversations";
import { resolveServiceURL } from "./resolve-service-url";
import type { ChatEvent } from "./types";

type Param = {
  name: string;
  value: any;
};

export async function* chatStream(
  userMessage: string,
  params: {
    thread_id: string;
    resources?: Array<Resource>;
    auto_accepted_plan: boolean;
    max_plan_iterations: number;
    max_step_num: number;
    max_search_results?: number;
    retriever_similarity?: number | undefined;
    retriever_limit?: number | undefined;
    interrupt_feedback?: string;
    enable_deep_thinking?: boolean;
    enable_background_investigation: boolean;
    enable_web_search?: boolean;
    enable_rag?: boolean;
    auto_select_kb?: boolean;
    report_style?: "academic" | "popular_science" | "news" | "social_media";
    mcp_settings?: {
      servers: Record<
        string,
        MCPServerMetadata & {
          enabled_tools: string[];
          add_to_agents: string[];
        }
      >;
    };
    rag_configs?: Array<{
      rag_platform_id: string;
      platform: string;
      api_url: string;
      retrieval_size: number;
      similarity: number;
      ext_config: Record<string, any>;
    }>;
    param_list?: Array<any>;
    plan?: any;
    max_step_retry?: number;
    min_step_score?: number;
  },
  options: { abortSignal?: AbortSignal } = {},
) {
  if (
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY ||
    location.search.includes("mock") ||
    location.search.includes("replay=") ||
    location.search.includes("thread_id=")
  )
    return yield* chatReplayStream(userMessage, params, options);

  try {
    const stream = fetchStream(resolveServiceURL("chat/stream"), {
      body: JSON.stringify({
        messages: [{ role: "user", content: userMessage }],
        ...params,
      }),
      signal: options.abortSignal,
    });
    for await (const event of stream) {
      yield {
        type: event.event,
        data: JSON.parse(event.data),
      } as ChatEvent;
    }
  } catch (e) {
    console.error(e);
  }
}

async function* chatReplayStream(
  userMessage: string,
  params: {
    thread_id?: string;
    auto_accepted_plan?: boolean;
    max_plan_iterations?: number;
    max_step_num?: number;
    max_search_results?: number;
    retriever_similarity?: number;
    retriever_limit?: number;
    interrupt_feedback?: string;
    param_list?: Array<any>;
  } = {
      thread_id: "__mock__",
      auto_accepted_plan: false,
      max_plan_iterations: 3,
      max_step_num: 1,
      max_search_results: 3,
      retriever_similarity: 0.4,
      retriever_limit: 0,
      interrupt_feedback: undefined,
      param_list: [],
    },
  options: { abortSignal?: AbortSignal } = {},
): AsyncIterable<ChatEvent> {
  const urlParams = new URLSearchParams(window.location.search);
  let replayFilePath = "";
  if (urlParams.has("mock")) {
    if (urlParams.get("mock")) {
      replayFilePath = `/mock/${urlParams.get("mock")!}.txt`;
    } else {
      if (params.interrupt_feedback === "accepted") {
        replayFilePath = "/mock/final-answer.txt";
      } else if (params.interrupt_feedback === "edit_plan") {
        replayFilePath = "/mock/re-plan.txt";
      } else {
        replayFilePath = "/mock/first-plan.txt";
      }
    }
  } else if (urlParams.has("thread_id")) {
    const threadId = extractFromSearchParams(
      window.location.search,
      "thread_id",
    );
    if (threadId) {
      replayFilePath = `/api/conversation/${threadId}`;
    } else {
      // Fallback to a default replay
      replayFilePath = `/replay/eiffel-tower-vs-tallest-building.txt`;
    }
  } else {
    const replayId = extractFromSearchParams(window.location.search, "replay");
    if (replayId) {
      replayFilePath = `/replay/${replayId}.txt`;
    } else {
      // Fallback to a default replay
      replayFilePath = `/replay/eiffel-tower-vs-tallest-building.txt`;
    }
  }
  const text = replayFilePath.startsWith("/api/conversation") ? await queryConversationByPath(replayFilePath, {
    abortSignal: options.abortSignal,
  }) : await fetchReplay(replayFilePath, {
    abortSignal: options.abortSignal,
  });
  const normalizedText = text.replace(/\r\n/g, "\n");
  const chunks = normalizedText.split("\n\n");

  for (const chunk of chunks) {
    const [eventRaw, dataRaw] = chunk.split("\n") as [string, string];
    const [, event] = eventRaw.split("event: ", 2) as [string, string];
    if (!dataRaw) {
      continue; // 跳过无效数据
    }
    const [, data] = dataRaw.split("data: ", 2) as [string, string];

    try {
      const chatEvent = {
        type: event,
        data: JSON.parse(data),
      } as ChatEvent;
      // 简化的内容分析器 - 专注于流式效果优化
      const analyzeContentForTypewriter = (content: string, contentType: string) => {
        if (!content) return {};

        // 基础分析 - 仅保留对流式效果有用的信息
        const lastChar = content.slice(-1);
        const isPunctuation = /[.!?;:,，。！？；：]/.test(lastChar);
        const isWordEnd = /\s+$/.test(content) || isPunctuation;
        const chunkLength = content.length;

        return {
          chunkLength,
          isPunctuation,
          isWordEnd,
        };
      };

      if (chatEvent.type === "message_chunk") {
        if (!chatEvent.data.finish_reason) {
          const content = chatEvent.data.content || '';
          const context = analyzeContentForTypewriter(content, 'message_chunk');
          // 仅在非最高速时使用打字机效果
          if (fastForwardSpeed < 5) {
            await sleepInReplay(50, 'message_chunk', context);
          }
        }
      } else if (chatEvent.type === "tool_call_result") {
        const content = JSON.stringify(chatEvent.data || {});
        const context = analyzeContentForTypewriter(content, 'tool_call_result');
        // 仅在非最高速时使用打字机效果
        if (fastForwardSpeed < 5) {
          await sleepInReplay(500, 'tool_call_result', context);
        }
      }
      yield chatEvent;
      if (chatEvent.type === "tool_call_result") {
        const content = JSON.stringify(chatEvent.data || {});
        const context = analyzeContentForTypewriter(content, 'tool_call_result');
        // 仅在非最高速时使用打字机效果
        if (fastForwardSpeed < 5) {
          await sleepInReplay(800, 'tool_call_result', context);
        }
      } else if (chatEvent.type === "message_chunk") {
        if (chatEvent.data.role === "user") {
          const content = chatEvent.data.content || '';
          const context = analyzeContentForTypewriter(content, 'user_message');
          // 仅在非最高速时使用打字机效果
          if (fastForwardSpeed < 5) {
            await sleepInReplay(500, 'user_message', context);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

const replayCache = new Map<string, string>();
export async function fetchReplay(
  url: string,
  options: { abortSignal?: AbortSignal } = {},
) {
  if (replayCache.has(url)) {
    return replayCache.get(url)!;
  }
  const res = await fetch(url, {
    signal: options.abortSignal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch replay: ${res.statusText}`);
  }
  const text = await res.text();
  replayCache.set(url, text);
  return text;
}

export async function fetchReplayTitle() {
  const res = chatReplayStream(
    "",
    {
      thread_id: "__mock__",
      auto_accepted_plan: false,
      max_plan_iterations: 3,
      max_step_num: 1,
      max_search_results: 3,
    },
    {},
  );
  for await (const event of res) {
    if (event.type === "message_chunk") {
      return event.data.content;
    }
  }
}

// 快进速度状态：0 = 正常速度, 1 = 2倍速, 2 = 4倍速, 3 = 6倍速, 4 = 8倍速, 5 = 直接输出无延时
let fastForwardSpeed = 0;

let sleepWorker: Worker | null = null;
let sleepPromises = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout?: NodeJS.Timeout }>();
let messageIdCounter = 0;
let isWorkerInitializing = false;

// 清理过期的Promise，防止内存泄漏
function cleanupExpiredPromises() {
  const now = Date.now();
  sleepPromises.forEach((promise, id) => {
    // 清理超过10秒的Promise
    if (promise.timeout && now - (promise.timeout as any) > 10000) {
      promise.resolve(); // 直接resolve避免卡死
      sleepPromises.delete(id);
    }
  });
}

// 统一的Worker初始化函数
async function initializeSleepWorker(): Promise<Worker> {
  if (sleepWorker && !isWorkerInitializing) {
    return sleepWorker;
  }

  if (isWorkerInitializing) {
    // 等待初始化完成
    return new Promise((resolve) => {
      const checkWorker = () => {
        if (sleepWorker && !isWorkerInitializing) {
          resolve(sleepWorker);
        } else {
          setTimeout(checkWorker, 10);
        }
      };
      checkWorker();
    });
  }

  isWorkerInitializing = true;

  try {
    sleepWorker = new Worker(new URL('../workers/sleep-worker.ts', import.meta.url), {
      type: 'module',
    });

    sleepWorker.addEventListener('message', (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'sleepComplete') {
        const { id } = message;
        const promise = sleepPromises.get(id);
        if (promise) {
          promise.resolve();
          sleepPromises.delete(id);
        }
      }
    });

    sleepWorker.addEventListener('error', (error) => {
      console.error('Sleep Worker error:', error);
      // 拒绝所有 pending 的 promise
      sleepPromises.forEach((promise) => {
        promise.reject(new Error('Sleep Worker error'));
      });
      sleepPromises.clear();
      sleepWorker = null;
      isWorkerInitializing = false;
    });

    // 发送当前速度设置
    sleepWorker.postMessage({ type: 'setSpeed', speed: fastForwardSpeed });
    return sleepWorker;
  } catch (error) {
    console.error('Failed to initialize worker:', error);
    isWorkerInitializing = false;
    throw error;
  } finally {
    isWorkerInitializing = false;
  }
}

// 获取Worker实例
function getSleepWorker(): Worker {
  if (!sleepWorker) {
    throw new Error('Worker not initialized. Call initializeSleepWorker() first.');
  }
  return sleepWorker;
}

export async function fastForwardReplay(value: number) {
  // 防抖处理，避免频繁调用
  if (fastForwardSpeed === value) {
    return;
  }

  fastForwardSpeed = value;

  try {
    const worker = await initializeSleepWorker();
    worker.postMessage({ type: 'setSpeed', speed: fastForwardSpeed });
  } catch (error) {
    console.error('Failed to update speed:', error);
  }
}

export async function sleepInReplay(
  ms: number,
  contentType?: 'message_chunk' | 'tool_call_result' | 'user_message',
  context?: {
    chunkLength?: number;
    isPunctuation?: boolean;
    isWordEnd?: boolean;
  }
) {
  // 快速路径：速度为5时直接返回，不创建Promise
  if (fastForwardSpeed === 5) {
    return Promise.resolve();
  }

  // 定期清理过期Promise
  if (messageIdCounter % 100 === 0) {
    cleanupExpiredPromises();
  }

  const id = `sleep-${++messageIdCounter}`;

  return new Promise<void>((resolve, reject) => {
    // 设置超时保护
    const timeoutId = setTimeout(() => {
      console.warn(`Sleep timeout for id: ${id}, resolving to prevent deadlock`);
      resolve();
      sleepPromises.delete(id);
    }, 5000); // 5秒超时

    // 存储 promise 的 resolve 和 reject
    sleepPromises.set(id, {
      resolve: () => {
        clearTimeout(timeoutId);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      timeout: timeoutId as any
    });

    // 发送消息给 worker
    initializeSleepWorker().then(worker => {
      worker.postMessage({
        type: 'sleep',
        id,
        ms,
        fastForwardSpeed,
        contentType,
        ...context,
      });
    }).catch(error => {
      clearTimeout(timeoutId);
      reject(error);
      sleepPromises.delete(id);
    });
  });
}
