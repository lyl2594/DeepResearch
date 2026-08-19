// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

export type MessageRole = "user" | "assistant" | "tool";

interface activityInterface{
  activity_type?:string
  activity_name?:string
}
interface additional_infoInterface {
  activity?:activityInterface
  re_execute_times?: number;
  retrieval_review?: {
    query?: string;
    similarity?: number;
    documents?: Array<{
      id?: string;
      title?: string;
      resource_title?: string;
      chunks?: Array<{ content?: string; similarity?: number }>;
    }>;
  };
}
export interface Message {
  id: string;
  threadId: string;
  agent?:
  | "coordinator"
  | "planner"
  | "researcher"
  | "coder"
  | "reporter"
  | "podcast"
  | "eval"
  | "final_report_evaluator"
  | "recognize_knowy";
  role: MessageRole;
  isStreaming?: boolean;
  content: string;
  contentChunks: string[];
  reasoningContent?: string;
  reasoningContentChunks?: string[];
  toolCalls?: ToolCallRuntime[];
  options?: Option[];
  finishReason?: "stop" | "interrupt" | "tool_calls";
  interruptFeedback?: string;
  resources?: Array<Resource>;
  evaluation?: EvaluationResult;
  nodeType?:string,
  step?:string,
  step_title?:string,
  additional_info?:additional_infoInterface, // ("recognize_knowy", "识别知识库")("execute_research", "执行研究")("evaluate_research", "评估研究结果")
  checkpoint_id?:string,
  evaluation_data?:string,
}

export interface EvaluationResult {
  result?: string;
  stepId?: string;
  stepTitle?: string;
  stepType?: string;
  qualityScore?: number;
  feedback?: string;
  evaluationTimestamp?: string;
  evaluatorName?: string;
  evaluationStatus?: string;
}

export interface Option {
  text: string;
  value: string;
}

export interface ToolCallRuntime {
  id: string;
  name: string;
  args: Record<string, unknown>;
  argsChunks?: string[];
  result?: string;
  contentTxt?:unknown,
  retriever_keyword?:string,
  step?:string,
}

export interface Resource {
  uri: string;
  title: string;
  rag_platform_id: string;
}

export interface Param {
  name: string;
  value: string;
}
export interface Conversation {
  id: string;
  title: string;
  count: number;
  date: string;
  category: string;
  data_type: string;
}
