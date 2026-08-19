// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { PythonOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import { LRUCache } from "lru-cache";
import {
  BookOpenText,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Loader,
  PencilRuler,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { docco } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { dark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { Button, Col, Form, Input, InputNumber, Row } from "antd";
import { ContentDialog } from "~/app/chat/components/content-dialog";
import { FavIcon } from "~/components/deer-flow/fav-icon";
import Image from "~/components/deer-flow/image";
import { LoadingAnimation } from "~/components/deer-flow/loading-animation";
import { Markdown } from "~/components/deer-flow/markdown";
import { RainbowText } from "~/components/deer-flow/rainbow-text";
import { Tooltip } from "~/components/deer-flow/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Skeleton } from "~/components/ui/skeleton";
import { findMCPTool } from "~/core/mcp";
import type { EvaluationResult, ToolCallRuntime } from "~/core/messages";
import { sendMessage, useMessage, useStore, useToolCalls } from "~/core/store";
import { getChatStreamSettings } from "~/core/store/settings-store";
import { parseJSON } from "~/core/utils";
import { processContent } from "~/core/utils/markdown";
import { cn } from "~/lib/utils";
import type { Message } from "../../../core/messages";
import { CollapseBlock } from "./CollapseBlock";
import { ThoughtBlock } from "./ThoughtBlock";
let timerRef: any = null; // 用于存储定时器的引用

export function ResearchActivitiesBlock({
  className,
  researchId,
}: {
  className?: string;
  researchId: string;
}) {
  const activityIds = useStore((state) =>
    state.researchActivityIds.get(researchId),
  )!;

  const ongoing = useStore((state) => state.ongoingResearchId === researchId);
  const messages = useStore((state) => state.messages);

  // 按步骤分组 activityIds，每个步骤只渲染一个容器
  const groupedActivities: any = {};
  // 获取所有步骤键，用于确定当前活动步骤
  const stepKeys: string[] = [];

  // 添加空值检查，避免 activityIds 为 undefined
  if (activityIds && activityIds.length > 0) {
    activityIds.forEach((activityId, index) => {
      // 跳过第一个活动项（通常是起始项）
      if (index === 0) return;

      const message = messages.get(activityId);
      // 提取步骤标识：step1, step2, step3 等
      const stepMatch = message?.step?.match(/^step(\S+)/i);
      const stepKey: any = stepMatch ? stepMatch[1] : "other";
      // 安全地初始化数组并添加 activityId
      if (!groupedActivities[stepKey]) {
        groupedActivities[stepKey] = {
          ids: [],
          title: message?.step_title || "",
        };
        if (stepKey !== "other") {
          stepKeys.push(stepKey);
        }
      }
      groupedActivities[stepKey]!.ids.push(activityId);
      if (message?.agent && message?.agent == "reporter") {
      }
    });
  }

  // 排序步骤键，确定当前活动步骤（最后一个步骤）
  stepKeys.sort((a, b) => parseInt(a) - parseInt(b));

  // 检查是否有 reporter 消息，如果有则所有步骤都已完成
  const hasReporterMessage = activityIds.some((activityId) => {
    const message = messages.get(activityId);
    return message?.agent === "reporter";
  });

  // 如果有 reporter 消息，则所有步骤都已完成，activeStep 设为 null
  // 否则 activeStep 设为最后一个步骤
  const activeStep: string | null = hasReporterMessage
    ? null
    : stepKeys.length > 0
      ? stepKeys[stepKeys.length - 1]!
      : null;

  return (
    <>
      <div className={cn("flex flex-col py-4", className)}>
        {Object.entries(groupedActivities).map(([stepKey, stepData]) => {
          const isStepContainer = stepKey !== "other";

          // 添加空值检查，确保 stepData 存在且不为空
          if (!stepData || !stepData.ids || stepData.ids.length === 0)
            return null;

          if (isStepContainer) {
            return (
              <StepContainer
                key={stepKey}
                stepKey={stepKey}
                activityIds={stepData.ids}
                stepTitle={stepData.title}
                activeStep={activeStep}
              />
            );
          }

          // 非步骤消息直接渲染 ActivityItem
          return stepData.ids.map((activityId, index) => (
            <ActivityItem
              key={activityId}
              activityId={activityId}
              index={index}
              stepKey={stepKey}
              isLast={index === stepData.ids.length - 1}
            />
          ));
        })}
      </div>
      {ongoing && !hasReporterMessage && <LoadingAnimation className="mx-4 my-12" />}
    </>
  );
}

export function EvaluationDisplay({
  evaluation,
}: {
  evaluation: EvaluationResult;
}) {
  const t = useTranslations("chat.research");

  // 根据评分显示不同的颜色
  const getScoreColor = (score?: number) => {
    if (!score) return "text-muted-foreground";
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreIcon = (score?: number) => {
    if (!score) return "📊";
    if (score >= 0.8) return "✅";
    if (score >= 0.6) return "⚠️";
    return "❌";
  };

  const getBgColor = (score?: number) => {
    if (!score) return "bg-muted/30";
    if (score >= 0.8) return "bg-green-50 dark:bg-green-950/30";
    if (score >= 0.6) return "bg-yellow-50 dark:bg-yellow-950/30";
    return "bg-red-50 dark:bg-red-950/30";
  };

  const getBorderColor = (score?: number) => {
    if (!score) return "border-muted";
    if (score >= 0.8) return "border-green-200 dark:border-green-800";
    if (score >= 0.6) return "border-yellow-200 dark:border-yellow-800";
    return "border-red-200 dark:border-red-800";
  };

  // 如果没有完整的评估数据，显示基本信息
  if (
    !evaluation.qualityScore &&
    !evaluation.stepTitle &&
    !evaluation.feedback
  ) {
    return (
      <motion.div
        className="bg-muted/20 border-border mt-3 rounded-lg border p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span>📊</span>
          <span>{evaluation.result || "暂无评估结果"}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`bg-card mt-3 overflow-hidden rounded-lg border shadow-sm transition-all duration-200 hover:shadow-md ${getBorderColor(evaluation.qualityScore)}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* 评分头部 */}
      <div className={`px-4 py-3 ${getBgColor(evaluation.qualityScore)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-base font-medium">
              评估结果
            </span>
          </div>
          {evaluation.qualityScore && (
            <div
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getScoreColor(evaluation.qualityScore).replace("text-", "bg-").replace("600", "100")} ${getScoreColor(evaluation.qualityScore)}`}
            >
              {(evaluation.qualityScore * 100).toFixed(0)} 分
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* 步骤信息 */}
        {evaluation.stepTitle && (
          <div className="mb-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 text-primary mt-0.5 flex h-5 w-5 items-center justify-center rounded-full">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-list-checks"
                >
                  <path d="m3 17 2 2 4-4" />
                  <path d="m3 7 2 2 4-4" />
                  <path d="M13 6h8" />
                  <path d="M13 12h8" />
                  <path d="M13 18h8" />
                </svg>
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">
                  步骤
                </p>
                <p className="text-foreground text-sm">
                  {evaluation.stepTitle}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 反馈内容 */}
        {evaluation.feedback && (
          <div className="mb-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-message-circle"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">
                  反馈建议
                </p>
                <p className="text-foreground text-sm leading-relaxed">
                  {evaluation.feedback}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 时间戳 */}
        {evaluation.evaluationTimestamp && (
          <div className="text-muted-foreground border-border/50 flex items-center gap-2 border-t pt-3 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-clock"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              {new Date(evaluation.evaluationTimestamp).toLocaleString(
                "zh-CN",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
// 最终评估结果
export function EvaluationFinally({
  evaluation,
}: {
  evaluation: any;
}) {
  return (
    <section className="evaluation-result-box">
      <div className="evaluation-top">
        <div className="evaluation-title flex items-center gap-2">
          <span className="evaluation-title-icon bg-[url('/images/result-title.png')]"></span>
          <span>{evaluation?.evaluatorName}</span>
        </div>
      </div>
      <div className="evaluation-content">
        <div>反馈建议：</div>
        {evaluation?.feedback}
      </div>
      <div className="evaluation-footer">
        评估时间：{evaluation?.evaluationTimestamp}
      </div>
      <div className="evaluation-mark-icon bg-[url('/images/result-bg.png')]">{(evaluation.qualityScore * 100).toFixed(0)} 分</div>
    </section>
  )
}

function ActivityMessage({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (
    message?.agent &&
    message.content &&
    (!message?.finishReason || message?.finishReason != "interrupt")
  ) {
    if (message.agent !== "reporter" && message.agent !== "planner") {
      // 添加内容处理逻辑
      const processedContent = processContent(message.content);
      return (
        <div className="px-4 py-2">
          <Markdown animated checkLinkCredibility>
            {processedContent}
          </Markdown>
        </div>
      );
    }
  }
  return null;
}
// 思考过程
function ThinkMessage({ messageId }: { messageId: string }) {
  const messages = useStore((state) => state.messages);
  const message: any = useMessage(messageId);
  const reasoningContent = message.reasoningContent;
  const hasMainContent = Boolean(
    message.content && message.content.trim() !== "",
  );

  const isLastMessage = useMemo(() => {
    const messageIds = Array.from(messages.keys());
    return messageIds.length > 0 && messageIds[messageIds.length - 1] === messageId;
  }, [messages, messageId]);

  const isThinking = Boolean(reasoningContent && !hasMainContent && isLastMessage);

  if (reasoningContent) {
    return (
      <ThoughtBlock
        content={reasoningContent}
        isStreaming={isThinking}
      />
    );
  }
  return null;
}

//  知识库来源
function ActivityDatasetList({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (
    message?.agent &&
    message.content &&
    !message.isStreaming &&
    message?.finishReason == "stop" &&
    message.agent !== "reporter" &&
    message.agent !== "planner"
  ) {
    const datasetList = extractResourceTitlesUnique(message.content);
    if (datasetList.length > 0) {
      return (
        <section className="dataset-section mt-4 pl-4">
          <div className="dataset-box-wrapper">
            <div className="dataset-box-title flex items-center">
              <img
                src="./images/dataset.png"
                className="dataset-box-title-icon"
                alt=""
              />
              <span className="ml-[6px]">知识库来源：</span>
            </div>
            <div className="dataset-box-content">
              {datasetList.map((item: any, index: number) => {
                return (
                  <div className="dataset-box-content-item" key={index}>
                    <img
                      src="./images/dataset-item.png"
                      className="dataset-box-content-img"
                      alt=""
                    />
                    <span className="dataset-box-content-txt">{item}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }
  }
  return null;
}


/**
 * 从 markdown 表格里摘出“资源标题”列（自动去重）
 * @param {string} md 完整的 markdown 字符串
 * @returns {string[]} 该列所有非空标题，找不到返回 []
 */
function extractResourceTitlesUnique(md = "") {
  if (typeof md !== "string") return [];

  // 找到表格的起始位置
  const tableStart = md.indexOf("| 标题");
  if (tableStart === -1) return [];

  // 找到表格的结束位置（下一个空行或文档结束）
  const tableEnd = md.indexOf("\n\n", tableStart);
  const tableContent = tableEnd === -1 ? md.substring(tableStart) : md.substring(tableStart, tableEnd);

  // 将表格内容按行分割
  const lines = tableContent.split("\n");

  // 查找表格分隔符行的索引
  const separatorIdx = lines.findIndex((line) =>
    /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
  );

  // 如果没有找到分隔符行，或者分隔符行之前没有标题行，返回空数组
  if (separatorIdx < 1) return [];

  // 解析表头
  const headerCells = lines[separatorIdx - 1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  // 查找标题列的索引
  const titleColIdx = headerCells.findIndex((h) => h.toLowerCase() === "标题");
  if (titleColIdx === -1) return [];

  const titles = []; // 存储标题数据

  // 遍历表格数据行
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const cells = lines[i]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    // 如果当前行的单元格数量不足以包含标题列，跳过
    if (cells.length <= titleColIdx) continue;
    const cell = cells[titleColIdx];
    if (cell) titles.push(cell);
  }

  return titles; // 返回标题数组
}


export function NoRetrievedActivityMessage({
  messageId,
}: {
  messageId: string;
}) {
  const message: any = useMessage(messageId);
  const formRef = useRef<any>(null);
  const [form] = Form.useForm();
  const [disabled, setDisabled] = useState(false);
  const review = message?.additional_info?.retrieval_review;
  const documents = Array.isArray(review?.documents) ? review.documents : [];
  const initialValues = {
    human_retriever_query: review?.query || "",
    human_retriever_similarity:
      review?.similarity ?? getChatStreamSettings()?.retriever_similarity ?? 0.4,
  };
  // 检查是否应该显示组件
  const shouldShow = useMemo(() => {
    return message &&
      message.finishReason &&
      message.finishReason == "interrupt" &&
      message.nodeType &&
      message.nodeType == "retriever_review";
  }, [message]);
  const handleRetrySearch = async () => {
    if (disabled) {
      return;
    }
    setDisabled(true); // 设置按钮为不可点击
    const values = formRef.current?.getFieldsValue();
    try {
      await sendMessage("重新检索", {
        interruptFeedback: "reselect",
        silent: true,
        param_list: [
          {
            name: "human_retriever_similarity",
            value: String(values?.human_retriever_similarity),
          }, // 必须是字符串类型，否则会报错
          {
            name: "human_retriever_query",
            value: values?.human_retriever_query || "",
          }, // 如果没有输入值，去关键词的第一个，也没有取空值
        ],
      });

    } catch {
      setDisabled(false);
    }
  };
  const handleAccept = async () => {
    if (disabled) return;
    setDisabled(true);
    try {
      await sendMessage("接受知识库检索结果", {
        interruptFeedback: "continue",
        silent: true,
      });
    } catch {
      setDisabled(false);
    }
  };
  const onReset = () => {
    formRef.current?.resetFields(); // 回到 initialValues
  };

  // 仅在满足条件时显示
  if (shouldShow) {
    return (
      <section className="mt-4 pl-4">
        <div className="dataset-box">
          <div className="dataset-box-empty">
            <div className="dataset-box-empty-tips flex items-center justify-center">
              <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
              <span>
                {documents.length > 0
                  ? `已检索到 ${documents.length} 个知识库文档，请确认是否采用。`
                  : "当前没有检索到相关知识库来源，可修改参数重检或跳过。"}
              </span>
            </div>
            {documents.length > 0 && (
              <div className="px-4 pt-4">
                <div className="mb-2 text-sm text-muted-foreground">
                  关键词：{review?.query || "-"}；相似度阈值：
                  {Number(review?.similarity ?? 0).toFixed(3)}
                </div>
                <div className="space-y-2">
                  {documents.map((doc: any, index: number) => (
                    <div key={doc.id || index} className="rounded-md border p-3">
                      <div className="font-medium">{doc.title || `文档 ${index + 1}`}</div>
                      <div className="text-xs text-muted-foreground">
                        来源：{doc.resource_title || "未知"}
                      </div>
                      {(doc.chunks || []).slice(0, 3).map((chunk: any, chunkIndex: number) => (
                        <div key={chunkIndex} className="mt-2 text-sm">
                          <span className="font-medium">
                            分值：{typeof chunk.similarity === "number" ? chunk.similarity.toFixed(4) : "-"}
                          </span>
                          <div className="line-clamp-2 text-muted-foreground">{chunk.content}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="dataset-box-empty-form">
              <Form
                ref={formRef}
                form={form}
                layout="vertical"
                initialValues={initialValues}
              >
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      label="检索关键词"
                      name="human_retriever_query"
                      rules={[{ required: false, message: "请输入检索关键词" }]}
                    >
                      <Input placeholder="请输入检索关键词" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label="相似度高于"
                      name="human_retriever_similarity"
                      rules={[{ required: false, message: "请输入相似度高于" }]}
                    >
                      <InputNumber
                        min={0}
                        max={1}
                        controls={true}
                        step={0.1} // 每次按键步进 0.1
                        precision={3} // 强制保留 3 位小数
                        formatter={(val) => Number(val).toFixed(3)} // 失去焦点时也保持 3 位
                        className="width-full"
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Col span={24}>
                  <div className="submit-btn-box flex justify-center">
                    <Button
                      className="submit-btn-cancel-ant"
                      onClick={onReset}
                      disabled={disabled}
                    >
                      重置参数
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={handleRetrySearch}
                      disabled={disabled}
                    >
                      修改后重新检索
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={handleAccept}
                      disabled={disabled}
                    >
                      {documents.length > 0 ? "接受并继续" : "跳过知识库继续"}
                    </Button>
                  </div>
                </Col>
              </Form>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return null;
}

export function LlmOutputActivityMessage({
  messageId,
}: {
  messageId: string;
}) {
  const messages = useStore((state) => state.messages);
  const message: any = useMessage(messageId);
  const formRef = useRef<any>(null);
  const [form] = Form.useForm();
  const [disabled, setDisabled] = useState(false);
  const [isVisible, setIsVisible] = useState(true); // 默认显示
  const [count, setCount] = useState(30); // 初始化为30秒
  const initialValues = {
    human_retriever_query: "",
    human_retriever_similarity: getChatStreamSettings()?.retriever_similarity || 0.4,
  };
  const urlParams = new URLSearchParams(window.location.search);
  // 检查是否应该显示组件
  const shouldShow = useMemo(() => {
    return isVisible &&
      message &&
      message.finishReason &&
      message.finishReason == "interrupt" &&
      message.nodeType &&
      message.nodeType == "llm_output_review";
  }, [message, isVisible]);
  let timer: any = null;
  /* --------- 统一的倒计时逻辑 --------- */
  useEffect(() => {
    // 只有在应该显示组件时才执行倒计时逻辑
    if (shouldShow) {
      document.querySelectorAll('.documents-empty').forEach((el, i, arr) => i === arr.length - 1 && (el.style.display = 'none'));
      if (count > 0) {
        timer = setTimeout(() => {
          setCount(count - 1);
        }, 1000);
        return () => clearTimeout(timer);
      } else {
        handleOutputMode(true);
      }
    }
  }, [count, shouldShow]);

  // 组件每次显示时重新开始倒计时
  useEffect(() => {
    // 只有在应该显示组件时才重置倒计时
    if (shouldShow) {
      setCount(30);
    }
    // 如果是回放 不展示倒计时
    if (urlParams.has("thread_id")) {
      timer && clearTimeout(timer);
      timer = null;
      setCount(0);       // 设置倒计时为0
      setDisabled(true); // 设置按钮为不可点击
    }
  }, [shouldShow]);

  const handleOutputMode = async (isDirectOutput: boolean) => {
    clearTimeout(timer);
    if (disabled) {
      return;
    }
    setDisabled(true); // 设置按钮为不可点击
    setCount(0);
    try {
      sendMessage(isDirectOutput ? "模型直接回答" : "不使用模型回答", {
        interruptFeedback: "continue",
        silent: true,
        param_list: [
          {
            name: "direct_output",
            value: isDirectOutput ? "true" : "false",
          }, // 必须是字符串类型，否则会报错
        ],
      });
      // 发送消息成功后隐藏组件
      // setIsVisible(false);
    } catch { }
  };

  // 仅在满足条件时显示
  if (shouldShow) {
    return (
      <section className="mt-4 pl-4">
        <div className="dataset-box">
          <div className="dataset-box-empty">
            <div className="dataset-box-empty-tips flex items-center justify-center">
              <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
              <span>
                当前没有检索到背景知识，请选择是否由模型直接回答！
              </span>
              {count > 0 && <span>倒计时：{count}S</span>}
            </div>
            <div className="dataset-box-empty-form">
              <Form
                ref={formRef}
                form={form}
                layout="vertical"
                initialValues={initialValues}
              >
                <Col span={24}>
                  <div className="submit-btn-box flex justify-center">
                    <Button
                      className="submit-btn-cancel-ant"
                      onClick={() => handleOutputMode(false)}
                      disabled={disabled}
                    >
                      否
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={() => handleOutputMode(true)}
                      disabled={disabled}
                    >
                      是
                    </Button>
                  </div>
                </Col>
              </Form>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return null;
}

function ReportReviewActivityMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  const [disabled, setDisabled] = useState(false);
  const shouldShow =
    message?.finishReason === "interrupt" &&
    message?.nodeType === "report_review";

  if (!shouldShow) {
    return null;
  }

  const resumeReport = async (feedback: "accepted" | "continue") => {
    if (disabled) return;
    setDisabled(true);
    try {
      await sendMessage(
        feedback === "accepted" ? "接受报告" : "重新生成报告",
        { interruptFeedback: feedback, silent: true },
      );
    } catch {
      setDisabled(false);
    }
  };

  return (
    <section className="mt-4 pl-4">
      <div className="dataset-box">
        <div className="dataset-box-empty">
          <div className="dataset-box-empty-tips flex items-center justify-center">
            <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
            <span>报告已生成，请确认是否接受。</span>
          </div>
          <div className="submit-btn-box flex justify-center">
            <Button
              className="submit-btn-cancel-ant"
              onClick={() => void resumeReport("continue")}
              disabled={disabled}
            >
              重新生成
            </Button>
            <Button
              className="submit-btn-shure-ant ml-2.5"
              type="primary"
              onClick={() => void resumeReport("accepted")}
              disabled={disabled}
            >
              接受报告
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityListItem({ messageId }: { messageId: string }) {
  const message: Message | undefined = useMessage(messageId);

  if (message) {
    if (!message.isStreaming && message.toolCalls?.length) {
      const toolCallComponents = message.toolCalls
        .filter(
          (toolCall) =>
            toolCall.result !== undefined &&
            !(
              typeof toolCall.result === "string" &&
              toolCall.result?.startsWith("Error")
            ),
        )
        .map((toolCall) => {
          if (toolCall.name === "web_search") {
            return <WebSearchToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "crawl_tool") {
            return <CrawlToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "python_repl_tool") {
            return <PythonToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "local_search_tool") {
            return (
              <RetrieverToolCall
                key={toolCall.id}
                toolCall={toolCall}
                messageId={messageId}
              />
            );
          } else {
            return <MCPToolCall key={toolCall.id} toolCall={toolCall} />;
          }
        });

      if (toolCallComponents.length > 0) {
        return <>{toolCallComponents}</>;
      }
    }
    if (message.agent === "eval" && message.evaluation) {
      return (
        <div className="px-4 py-2">
          <EvaluationDisplay evaluation={message.evaluation} />
        </div>
      );
    }
  }
  return null;
}

function ActivityKeywords({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (message) {
    if (!message.isStreaming && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        switch (toolCall.name) {
          case "local_search_tool":
            return <KeywordsList key={toolCall.id} toolCall={toolCall} />;
          default:
            return null;
        }
      }
    }
    return null;
  }
}

const __pageCache = new LRUCache<string, string>({ max: 100 });
type SearchResult =
  | {
    type: "page";
    title: string;
    url: string;
    content: string;
  }
  | {
    type: "image";
    image_url: string;
    image_description: string;
  };

function WebSearchToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const searching = useMemo(() => {
    return toolCall.result === undefined;
  }, [toolCall.result]);
  const searchResults = useMemo<SearchResult[]>(() => {
    let results: SearchResult[] | undefined = undefined;
    try {
      results = toolCall.result ? parseJSON(toolCall.result, []) : undefined;
    } catch {
      results = undefined;
    }
    if (Array.isArray(results)) {
      results.forEach((result) => {
        if (result.type === "page") {
          __pageCache.set(result.url, result.title);
        }
      });
    } else {
      results = [];
    }
    return results;
  }, [toolCall.result]);
  const pageResults = useMemo(
    () => searchResults?.filter((result) => result.type === "page"),
    [searchResults],
  );
  const imageResults = useMemo(
    () => searchResults?.filter((result) => result.type === "image"),
    [searchResults],
  );
  return (
    <section className="mt-4 pl-4">
      <div className="font-medium italic">
        <RainbowText
          className="flex items-center"
          animated={searchResults === undefined}
        >
          <Search size={16} className={"mr-2"} />
          <span>{t("searchingFor")}&nbsp;</span>
          <span className="max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap">
            {(toolCall.args as { query: string }).query}
          </span>
        </RainbowText>
      </div>
      <div className="pr-4">
        {pageResults && (
          <ul className="mt-2 flex flex-wrap gap-4">
            {searching &&
              [...Array(6)].map((_, i) => (
                <li
                  key={`search-result-${i}`}
                  className="flex h-40 w-40 gap-2 rounded-md text-sm"
                >
                  <Skeleton
                    className="to-accent h-full w-full rounded-md bg-gradient-to-tl from-slate-400"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                </li>
              ))}
            {pageResults
              .filter((result) => result.type === "page")
              .map((searchResult, i) => (
                <motion.li
                  key={`search-result-${i}`}
                  className="text-muted-foreground bg-accent flex max-w-40 gap-2 rounded-md px-2 py-1 text-sm"
                  initial={{ opacity: 0, y: 10, scale: 0.66 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    duration: 0.2,
                    delay: i * 0.1,
                    ease: "easeOut",
                  }}
                >
                  <FavIcon
                    className="mt-1"
                    url={searchResult.url}
                    title={searchResult.title}
                  />
                  <a href={searchResult.url} target="_blank">
                    {searchResult.title}
                  </a>
                </motion.li>
              ))}
            {imageResults.map((searchResult, i) => (
              <motion.li
                key={`search-result-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.66 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.2,
                  delay: i * 0.1,
                  ease: "easeOut",
                }}
              >
                <a
                  className="flex flex-col gap-2 overflow-hidden rounded-md opacity-75 transition-opacity duration-300 hover:opacity-100"
                  href={searchResult.image_url}
                  target="_blank"
                >
                  <Image
                    src={searchResult.image_url}
                    alt={searchResult.image_description}
                    className="bg-accent h-40 w-40 max-w-full rounded-md bg-cover bg-center bg-no-repeat"
                    imageClassName="hover:scale-110"
                    imageTransition
                  />
                </a>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CrawlToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const url = useMemo(
    () => (toolCall.args as { url: string }).url,
    [toolCall.args],
  );
  const title = useMemo(() => __pageCache.get(url), [url]);
  return (
    <section className="mt-4 pl-4">
      <div>
        <RainbowText
          className="flex items-center text-base font-medium italic"
          animated={toolCall.result === undefined}
        >
          <BookOpenText size={16} className={"mr-2"} />
          <span>{t("reading")}</span>
        </RainbowText>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4">
        <motion.li
          className="text-muted-foreground bg-accent flex h-40 w-40 gap-2 rounded-md px-2 py-1 text-sm"
          initial={{ opacity: 0, y: 10, scale: 0.66 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.2,
            ease: "easeOut",
          }}
        >
          <FavIcon className="mt-1" url={url} title={title} />
          <a
            className="h-full flex-grow overflow-hidden text-ellipsis whitespace-nowrap"
            href={url}
            target="_blank"
          >
            {title ?? url}
          </a>
        </motion.li>
      </ul>
    </section>
  );
}

function RetrieverToolCall({
  toolCall,
  messageId,
}: {
  toolCall: ToolCallRuntime;
  messageId: any;
}) {
  const t = useTranslations("chat.research");
  const ContentDialogRef = useRef<any>(null);
  const searching = useMemo(() => {
    return toolCall.result === undefined;
  }, [toolCall.result]);

  // print first 200 characters of toolCall.result
  // console.log("RetrieverToolCall: toolCall.result",
  //   toolCall.result && typeof toolCall.result === 'string'
  //     ? toolCall.result.substring(0, 200)
  //     : toolCall.result
  // );
  const documents = useMemo<
    Array<{
      id: string;
      title: string;
      content: string;
      resource_title: string;
      chunks?: Array<{ content?: string; similarity?: number }>;
    }>
  >(() => {
    return toolCall.result ? parseJSON(toolCall.result, []) : [];
  }, [toolCall.result]);

  const formatSimilarity = (value: number | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return value.toFixed(4);
  };

  const buildChunksForDisplay = (doc: {
    content?: string;
    chunks?: Array<{ content?: string; similarity?: number }>;
  }) => {
    if (!doc.chunks || doc.chunks.length === 0) return [];
    return doc.chunks.map((chunk) => ({
      content: chunk.content ?? "",
      similarity: formatSimilarity(chunk.similarity),
    }));
  };
  // console.log('retriever_keyword1111111111111111111111 ')
  // console.log(toolCall)

  // 回显重新输入的关键词
  const queryWord = useMemo(() => {
    return toolCall.retriever_keyword || "";
  }, [toolCall.retriever_keyword]);

  // 知识库弹框显示内容
  const handleContentDialog = (val: any) => {
    if (val?.content) {
      ContentDialogRef?.current?.showDialog(val);
    }
  };
  return (
    <section
      className={`mt-4 pl-4 ${documents.length === 0 ? "empty-documents" : ""}`}
    >
      <div className="font-medium italic">
        <RainbowText className="flex items-center" animated={searching}>
          <Search size={16} className={"mr-2"} />
          <span>{t("retrievingDocuments")}&nbsp;</span>
          <span className="max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap">
            {queryWord
              ? queryWord
              : (toolCall.args as { keywords: string }).keywords}
          </span>
        </RainbowText>
      </div>
      <div className="pr-4">
        {documents && (
          <ul className="mt-2 flex flex-wrap gap-4">
            {searching &&
              [...Array(2)].map((_, i) => (
                <li
                  key={`search-result-${i}`}
                  className="flex h-40 w-40 gap-2 rounded-md text-sm"
                >
                  <Skeleton
                    className="to-accent h-full w-full rounded-md bg-gradient-to-tl from-slate-400"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                </li>
              ))}
            {documents?.map((doc, i) => (
              <motion.li
                key={`search-result-${i}`}
                className="text-muted-foreground bg-accent laiyuan-box flex gap-2 rounded-md px-2 py-1 text-sm"
                initial={{ opacity: 0, y: 10, scale: 0.66 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.2,
                  delay: i * 0.1,
                  ease: "easeOut",
                }}
              >
                <FileText size={20} className="fileicon" />
                <div
                  className="laiyuan-content"
                  onClick={() => {
                    handleContentDialog?.({
                      ...doc,
                      chunks: buildChunksForDisplay(doc),
                    });
                  }}
                >
                  <div className="truncate" title={doc.title}>
                    {doc.title}
                  </div>
                  <div className="laiyuan-label">
                    <span>来源：</span>
                    <span className="laiyuan-value" title={doc?.resource_title}>
                      {doc?.resource_title}
                    </span>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
        {documents?.length === 0 && (
          <div className="documents-empty pl-4 py-2">当前没有检索到相关知识库来源</div>
        )}
      </div>
      <ContentDialog ref={ContentDialogRef}></ContentDialog>
    </section>
  );
}
// 检索关键词 内容块
function KeywordsList({ toolCall }: { toolCall: ToolCallRuntime }) {
  // 检索关键字
  const keyWords: any = useMemo(() => {
    let array =
      (toolCall.args?.keywords as any)?.split(" ").filter(Boolean) || [];
    return array;
  }, [toolCall.args]);
  // console.log('retriever_keyword=============== ')
  // console.log(toolCall)
  const queryWord = useMemo(() => {
    return toolCall.retriever_keyword || "";
  }, [toolCall.retriever_keyword]);
  return (
    <section className="mt-4 pl-4">
      {/* 检索关键词 */}
      {keyWords.length > 0 && (
        <div className="key-words-box">
          <div className="key-words-title flex items-center">
            <img
              src="./images/word-search.png"
              className="key-words-icon"
              alt=""
            />
            <span className="ml-[6px]">检索关键词：</span>
          </div>
          <div className="key-words-content">
            {queryWord && (
              <div className="key-words-item">
                <span>{queryWord}</span>
              </div>
            )}
            {!queryWord &&
              keyWords.map((doc: any, i: any) => (
                <div className="key-words-item" key={`keyWords-item-${i}`}>
                  <span>{doc}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
function PythonToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const code = useMemo<string | undefined>(() => {
    return (toolCall.args as { code?: string }).code;
  }, [toolCall.args]);
  const { resolvedTheme } = useTheme();
  return (
    <section className="mt-4 pl-4">
      <div className="flex items-center">
        <PythonOutlined className={"mr-2"} />
        <RainbowText
          className="text-base font-medium italic"
          animated={toolCall.result === undefined}
        >
          {t("runningPythonCode")}
        </RainbowText>
      </div>
      <div>
        <div className="bg-accent mt-2 max-h-[400px] max-w-[calc(100%-20px)] overflow-y-auto rounded-md p-2 text-sm">
          <SyntaxHighlighter
            language="python"
            style={resolvedTheme === "dark" ? dark : docco}
            customStyle={{
              background: "transparent",
              border: "none",
              boxShadow: "none",
            }}
          >
            {code?.trim() ?? ""}
          </SyntaxHighlighter>
        </div>
      </div>
      {toolCall.result && <PythonToolCallResult result={toolCall.result} />}
    </section>
  );
}

function PythonToolCallResult({ result }: { result: string }) {
  const t = useTranslations("chat.research");
  const { resolvedTheme } = useTheme();
  const hasError = useMemo(
    () => result.includes("Error executing code:\n"),
    [result],
  );
  const error = useMemo(() => {
    if (hasError) {
      const parts = result.split("```\nError: ");
      if (parts.length > 1) {
        return parts[1]!.trim();
      }
    }
    return null;
  }, [result, hasError]);
  const stdout = useMemo(() => {
    if (!hasError) {
      const parts = result.split("```\nStdout: ");
      if (parts.length > 1) {
        return parts[1]!.trim();
      }
    }
    return null;
  }, [result, hasError]);
  return (
    <>
      <div className="mt-4 font-medium italic">
        {hasError ? t("errorExecutingCode") : t("executionOutput")}
      </div>
      <div className="bg-accent mt-2 max-h-[400px] max-w-[calc(100%-20px)] overflow-y-auto rounded-md p-2 text-sm">
        <SyntaxHighlighter
          language="plaintext"
          style={resolvedTheme === "dark" ? dark : docco}
          customStyle={{
            color: hasError ? "red" : "inherit",
            background: "transparent",
            border: "none",
            boxShadow: "none",
          }}
        >
          {error ?? stdout ?? "(empty)"}
        </SyntaxHighlighter>
      </div>
    </>
  );
}

function MCPToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const tool = useMemo(() => findMCPTool(toolCall.name), [toolCall.name]);
  const { resolvedTheme } = useTheme();
  return (
    <section className="mt-4 pl-4">
      <div className="w-fit overflow-y-auto rounded-md py-0">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>
              <Tooltip title={tool?.description}>
                <div className="flex items-center font-medium italic">
                  <PencilRuler size={16} className={"mr-2"} />
                  <RainbowText
                    className="pr-0.5 text-base font-medium italic"
                    animated={toolCall.result === undefined}
                  >
                    Running {toolCall.name ? toolCall.name + "()" : "MCP tool"}
                  </RainbowText>
                </div>
              </Tooltip>
            </AccordionTrigger>
            <AccordionContent>
              {toolCall.result && (
                <div className="bg-accent max-h-[400px] max-w-[560px] overflow-y-auto rounded-md text-sm">
                  <SyntaxHighlighter
                    language="json"
                    style={resolvedTheme === "dark" ? dark : docco}
                    customStyle={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                  >
                    {toolCall.result.trim()}
                  </SyntaxHighlighter>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}

// 步骤容器组件 - 处理步骤的展开/收起功能
function StepContainer({
  stepKey,
  activityIds,
  stepTitle,
  activeStep,
}: {
  stepKey: string;
  activityIds: string[];
  stepTitle: string;
  activeStep: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="step-container mb-5" data-step={stepKey}>
      {/* 步骤头部 - 可点击展开/收起 */}
      <div className="step-content flex items-center justify-between p-3">
        <div className="flex items-center">
          <span className="flex items-center font-medium capitalize">
            <span className="step-status-box">
              {!activeStep ||
                (activeStep && parseInt(stepKey) < parseInt(activeStep)) ? (
                <Check size={12} className="step-status-icon" />
              ) : (
                <Loader size={12} className="step-status-icon animate-spin" />
              )}
            </span>
          </span>
          {!activeStep ||
            (activeStep && parseInt(stepKey) < parseInt(activeStep)) ? (
            <span className="step-title">
              步骤{Number(stepKey) + 1}：{stepTitle}
            </span>
          ) : (
            <span className="step-title">
              正在执行步骤{Number(stepKey) + 1}：{stepTitle}
            </span>
          )}
        </div>
        <span
          className="main-color flex cursor-pointer items-center"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span>{isExpanded ? "收起" : "展开"}</span>
          <ChevronDown
            className={`transform transition-transform ${isExpanded ? "rotate-180" : ""
              }`}
          />
        </span>
      </div>
      {/* 步骤内容 - 可展开/收起 */}
      <motion.div
        initial={false}
        animate={{
          height: isExpanded ? "auto" : "300px",
          opacity: isExpanded ? 1 : 1,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="relative overflow-hidden"
        style={{ maxHeight: isExpanded ? "none" : "300px" }}
      >
        <div
          className={cn("transition-all duration-300", !isExpanded && "pb-6")}
        >
          <StepActivityItems activityIds={activityIds} stepKey={stepKey} />
        </div>

        {/* 收起时的渐变遮罩 */}
        {!isExpanded && (
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-white to-transparent dark:from-gray-900" />
        )}
      </motion.div>
    </div>
  );
}

// 步骤活动项组件 - 处理重试次数分组和折叠
function StepActivityItems({
  activityIds,
  stepKey,
}: {
  activityIds: string[];
  stepKey: string;
}) {
  const messages = useStore((state) => state.messages);

  // 按 step 相同且重试次数>0且重试次数相同的分组，保持默认顺序
  const groupedItems = useMemo(() => {
    const stepRetryGroups: { [key: string]: { [key: number]: any[] } } = {};
    const result: any[] = [];

    activityIds.forEach((activityId) => {
      const message = messages.get(activityId);
      const retryCount = Number(message?.additional_info?.re_execute_times || 0);
      const stepKey = message?.step || '';

      // 只有重试次数>0的才分组
      if (retryCount > 0) {
        // 按 step 和 重试次数分组
        if (!stepRetryGroups[stepKey]) {
          stepRetryGroups[stepKey] = {};
        }
        if (!stepRetryGroups[stepKey][retryCount]) {
          stepRetryGroups[stepKey][retryCount] = [];
        }
        stepRetryGroups[stepKey][retryCount].push({ activityId, retryCount, message, stepKey });
      } else {
        // 其他情况直接添加到结果中
        result.push({ activityId, retryCount, message, isDirect: true });
      }
    });

    // 将分组按重试次数排序后添加到结果中
    Object.keys(stepRetryGroups).forEach(stepKey => {
      Object.keys(stepRetryGroups[stepKey])
        .map(Number)
        .sort((a, b) => a - b)
        .forEach(retryCount => {
          result.push({
            stepKey,
            retryCount,
            items: stepRetryGroups[stepKey][retryCount],
            isGroup: true
          });
        });
    });

    return result;
  }, [activityIds, messages]);

  return (
    <div>
      {/* 按默认顺序渲染，step相同且重试次数>0的分组展示 */}
      {groupedItems.map((item, index) => {
        if (item.isGroup) {
          // step和重试次数分组，使用 CollapseBlock 包裹
          return (
            <CollapseBlock
              key={`${item.stepKey}-${item.retryCount}`}
              title={<span className="text-xl font-semibold text-black">{`第${item.retryCount}次重新执行`}</span>}
            >
              {item.items.map((groupItem: any, groupIndex: number) => (
                <ActivityItem
                  key={groupItem.activityId}
                  activityId={groupItem.activityId}
                  index={groupIndex}
                  stepKey={stepKey}
                  isLast={groupIndex === item.items.length - 1}
                />
              ))}
            </CollapseBlock>
          );
        } else {
          // 直接展示的项目
          return (
            <ActivityItem
              key={item.activityId}
              activityId={item.activityId}
              index={index}
              stepKey={stepKey}
              isLast={index === groupedItems.length - 1}
            />
          );
        }
      })}
    </div>
  );
}

// 单独的活动项组件 - 专注于内容渲染，不处理容器逻辑
function ActivityItem({
  activityId,
  index,
  isLast,
  stepKey,
}: {
  activityId: string;
  index: number;
  isLast: boolean;
  stepKey: string;

}) {
  const message: any = useMessage(activityId);
  if (!message) {
    console.log('message is undefined, activityId:', activityId);
    return null
  }
  if (message.agent === "reporter" || message.agent === "final_report_evaluator") {
    return null
  }
  return (
    <>
      <CurrentOutMessage messageId={activityId} />
      {
        message.agent == 'eval' && !message.finishReason ? null : <motion.li
          key={activityId}
          style={{ transition: "all 0.4s ease-out" }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            ease: "easeOut",
          }}
          className="timeline-li"
          data-message-id={activityId}
        >
          {/* 思考模块 */}
          <ThinkMessage messageId={activityId} />
          {/* 没有背景知识时 */}
          <LlmOutputActivityMessage messageId={activityId} />
          {/* 最终报告审核 */}
          <ReportReviewActivityMessage messageId={activityId} />
          {/* markdown 模块 */}
          <ActivityMessage messageId={activityId} />
          {/* 关键词 */}
          <ActivityKeywords messageId={activityId} />
          {/* 有知识库时 */}
          <ActivityDatasetList messageId={activityId} />
          {/* 没有知识库时 */}
          <NoRetrievedActivityMessage messageId={activityId} />
          {/* 关键引用 */}
          <KnowledgeBaseLink messageId={activityId} stepKey={stepKey} />
          {/* 评价结果 */}
          <ActivityListItem messageId={activityId} key={activityId} />
          {!isLast && <hr className="my-8" />}
        </motion.li>
      }
    </>
  );
}
function KnowledgeBaseLink({ messageId, stepKey }: { messageId: string; stepKey: string }) {
  const message: any = useMessage(messageId);
  const [linkData, setLinkData] = useState<any>([])
  const toolCalls = useToolCalls();
  useEffect(() => {
    const newLinkData: any[] = [];
    toolCalls.forEach((item: any) => {
      if (item?.step && item?.step == (`step${stepKey}`) && item?.result) {
        try {
          let array = JSON.parse(item?.result)
          newLinkData.push(...array)
        } catch (error) {
          // 忽略解析错误
        }
      }
    })

    // 按 title 去重
    const uniqueLinkData = newLinkData.filter((item, index, arr) =>
      arr.findIndex(i => i.title === item.title) === index
    );

    // 只有当数据实际发生变化时才更新状态
    if (JSON.stringify(uniqueLinkData) !== JSON.stringify(linkData)) {
      setLinkData(uniqueLinkData)
    }
  }, [toolCalls, stepKey]) // 移除 linkData 依赖，避免无限循环
  if (!(message.agent === "researcher" && message.finishReason == 'stop')) {
    return null;
  }
  if (linkData.length == 0) {
    return null
  }
  return (
    <>
      <section className="mt-4 px-4 py-2">
        <div className="link-title bold text-[22px] font-bold">关键引用</div>
        <div className="link-content">
          {
            linkData.map((item: any, index: number) => {
              return (
                <div className="link-content-item flex items-center gap-2" key={item.id + '_' + index}>
                  <span className="link-content-item-mark"></span>
                  <a
                    href={`${item.url}&authTokenOnly=${item.authorization}`}
                    target="_blank"
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    {item.title}
                  </a>
                </div>
              )
            })
          }
        </div>
      </section>
    </>
  )
}
// 显示当前任务的名称
function CurrentOutMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  if (message.additional_info?.activity?.activity_name) {
    if (message.agent === "eval" && message.finishReason) {
      return null
    }
    return (
      <div className="current-work-box">
        {message.additional_info?.activity?.activity_name}
      </div>
    )
  }
  return null
}

// 显示当前步骤重试的次数
function AgainCountMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  const result = Number(message.additional_info?.re_execute_times || 0);

  return result > 0 && message.agent === "researcher" ? (
    <div className={`again-work-box again-count-${result}`}>
      当前步骤重试次数：{result}
    </div>
  ) : null;
}
