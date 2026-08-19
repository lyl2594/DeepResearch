// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

let fastForwardSpeed = 0;

interface SleepMessage {
  type: 'sleep';
  id: string;
  ms: number;
  fastForwardSpeed: number;
  contentType?: 'message_chunk' | 'tool_call_result' | 'user_message';
  // 简化的上下文信息
  chunkLength?: number;
  isPunctuation?: boolean;
  isWordEnd?: boolean;
}

interface SpeedMessage {
  type: 'setSpeed';
  speed: number;
}

interface ResponseMessage {
  type: 'sleepComplete';
  id: string;
}

// 设置快进速度
self.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  
  if (message.type === 'setSpeed') {
    fastForwardSpeed = (message as SpeedMessage).speed;
  } else if (message.type === 'sleep') {
    handleSleep(message as SleepMessage);
  }
});

async function handleSleep(message: SleepMessage) {
  const { 
    id, ms, fastForwardSpeed: currentSpeed, contentType,
    chunkLength, isPunctuation, isWordEnd
  } = message;
  
  // 当快进速度为5时，直接输出，不使用打字机效果
  if (currentSpeed === 5) {
    self.postMessage({ type: 'sleepComplete', id } as ResponseMessage);
    return;
  }
  
  // 使用优化的简化算法
  const streamDelay = calculateOptimizedDelay(ms, currentSpeed, contentType, {
    chunkLength,
    isPunctuation,
    isWordEnd,
  });
  
  // 简化的延时
  await simpleSleep(streamDelay);
  
  self.postMessage({ type: 'sleepComplete', id } as ResponseMessage);
}

// 优化的简化延迟算法
function calculateOptimizedDelay(
  baseMs: number, 
  speed: number, 
  contentType?: string,
  context?: {
    chunkLength?: number;
    isPunctuation?: boolean;
    isWordEnd?: boolean;
  }
): number {
  // 简化配置，减少计算复杂度
  const speedMultipliers = [1.0, 0.2, 0.1, 0.05, 0.025]; // 0-4速度级别
  const contentTypeWeights = {
    message_chunk: 1.0,
    tool_call_result: 1.5,
    user_message: 1.1,
    default: 1.0
  };
  
  // 快速计算
  const speedMultiplier = speedMultipliers[Math.min(speed, 4)] || 1.0;
  const contentTypeWeight = contentTypeWeights[contentType as keyof typeof contentTypeWeights] || 1.0;
  
  let delay = baseMs * speedMultiplier * contentTypeWeight;
  
  // 简化的上下文调整
  if (context?.isPunctuation) delay *= 1.3;
  if (context?.isWordEnd) delay *= 1.1;
  
  // 添加少量随机变化，避免完全机械
  const jitter = 1 + (Math.random() - 0.5) * 0.1; // ±5%变化
  delay *= jitter;
  
  // 限制范围
  delay = Math.max(delay, 3);
  delay = Math.min(delay, 200);
  
  return Math.round(delay);
}

// 简化的睡眠函数
async function simpleSleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  
  return new Promise<void>((resolve) => {
    // 使用最简单的setTimeout，避免过度优化
    setTimeout(resolve, delayMs);
  });
}

// 导出空对象以确保 ESM 模块格式
export {};