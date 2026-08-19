// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import type { Option } from "../messages";

// Tool Calls

export interface ToolCall {
  type: "tool_call";
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallChunk {
  type: "tool_call_chunk";
  index: number;
  id: string;
  name: string;
  args: string;
}

// Events

interface GenericEvent<T extends string, D extends object> {
  type: T;
  data: {
    id: string;
    thread_id: string;
    agent: "coordinator" | "planner" | "researcher" | "coder" | "reporter" | "eval" | "final_report_evaluator";
    role: "user" | "assistant" | "tool";
    finish_reason?: "stop" | "tool_calls" | "interrupt";
    node_type?: string;
  } & D;
}

export interface MessageChunkEvent
  extends GenericEvent<
    "message_chunk",
    {
      content?: string;
      reasoning_content?: string;
    }
  > {}

export interface ToolCallsEvent
  extends GenericEvent<
    "tool_calls",
    {
      tool_calls: ToolCall[];
      tool_call_chunks: ToolCallChunk[];
    }
  > {}

export interface ToolCallChunksEvent
  extends GenericEvent<
    "tool_call_chunks",
    {
      tool_call_chunks: ToolCallChunk[];
    }
  > {}

export interface ToolCallResultEvent
  extends GenericEvent<
    "tool_call_result",
    {
      tool_call_id: string;
      content?: string;
      retriever_keyword?: string;
      step?: string;
    }
  > {}

export interface InterruptEvent
  extends GenericEvent<
    "interrupt",
    {
      options: Option[];
    }
  > {}

export interface EvaluationEvent
  extends GenericEvent<
    "evaluation",
    {
      content?: string;
      evaluation_data?: {
        step_id?: string;
        step_title?: string;
        step_type?: string;
        quality_score?: number;
        feedback?: string;
        evaluation_timestamp?: string;
        evaluator_name?: string;
        evaluation_status?: string;
      };
    }
  > { }

export type ChatEvent =
  | MessageChunkEvent
  | ToolCallsEvent
  | ToolCallChunksEvent
  | ToolCallResultEvent
  | InterruptEvent
  | EvaluationEvent;
