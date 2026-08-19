// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState, useEffect } from "react";

import { LoadingAnimation } from "~/components/deer-flow/loading-animation";
import { Markdown } from "~/components/deer-flow/markdown";
import ReportEditor from "~/components/editor";
import { useReplay } from "~/core/replay";
import { useMessage, useStore, useToolCalls } from "~/core/store";
import { cn } from "~/lib/utils";
import { processContent, generateMarkdownFromLinkData } from "~/core/utils/markdown"
import { ThoughtBlock } from './ThoughtBlock'

export function ResearchReportBlock({
  className,
  messageId,
  editing,
  researchId,
}: {
  className?: string;
  researchId: string;
  messageId: string;
  editing: boolean;
}) {
  const message = useMessage(messageId);
  const { isReplay } = useReplay();
  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      if (message) {
        message.content = markdown;
        useStore.setState({
          messages: new Map(useStore.getState().messages).set(
            message.id,
            message,
          ),
        });
      }
    },
    [message],
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const isCompleted = message?.isStreaming === false && message?.content !== "";
  const isEnd = message?.isStreaming === false && message?.finishReason === "stop" && message?.content !== "";
  // TODO: scroll to top when completed, but it's not working
  // useEffect(() => {
  //   if (isCompleted && contentRef.current) {
  //     setTimeout(() => {
  //       contentRef
  //         .current!.closest("[data-radix-scroll-area-viewport]")
  //         ?.scrollTo({
  //           top: 0,
  //           behavior: "smooth",
  //         });
  //     }, 500);
  //   }
  // }, [isCompleted]);
  // 添加内容处理逻辑
  const processedContent = processContent(message?.content);
  return (
    <div ref={contentRef} className={cn("w-full pt-4 pb-8", className)}>
      {!isReplay && isCompleted && editing ? (
        <ReportEditor
          content={processedContent}
          onMarkdownChange={handleMarkdownChange}
        />
      ) : (
        <>
          {/* 思考模块 */}
          <ThinkMessage messageId={messageId} />
          <Markdown animated checkLinkCredibility>
            {processedContent}
          </Markdown>
          {/* 知识库引用，只有markdown渲染完以后才展示 */}
          {isEnd && <KnowledgeBaseLink />}
          {/* 最终评估结果 */}
          {isEnd && <EvaluationFinally researchId={researchId}></EvaluationFinally>}
          {message?.isStreaming && <LoadingAnimation className="my-12" />}
        </>
      )}
    </div>
  );
}
// 最终评估结果
export function EvaluationFinally({
  researchId,
}: {
  researchId: any;
}) {
  const messages = useStore((state) => state.messages);

  const [finallyReports, setFinallyReports] = useState([]);
  useEffect(() => {
    messages.forEach((value, key) => {
      if (
        value &&
        value.agent === 'final_report_evaluator'
      ) {
        setFinallyReports((prev: any) => {
          const exists = prev.some((item: any) => item.id === value.id);
          if (exists) return prev; // 已存在，跳过
          return [...prev, value]; // 不可变添加
        });
      }
    });
  }, [messages]);

    // 根据评分显示不同的颜色
  const getScoreColor = (score?: number) => {
    if (!score) return "score-none";
    if (score >= 0.8) return "score-green";
    if (score >= 0.6) return "score-yellow";
    return "score-red";
  };
  return (
    <>
    {/* {finallyReports?.length > 0 && <hr className="my-8" />} */}
      {finallyReports.map((item: any) => (
        <section key={item.id} className="evaluation-result-box">
          <div className="evaluation-top">
            <div className="evaluation-title flex items-center gap-2">
              <span className="evaluation-title-icon bg-[url('/images/result-title.png')]" />
              <span>{item?.evaluation?.evaluatorName}</span>
            </div>
          </div>

          <div className="evaluation-content">
            <div>反馈建议：</div>
            {item?.evaluation?.feedback}
          </div>

          <div className="evaluation-footer">
            评估时间：{item?.evaluation?.evaluationTimestamp?new Date(item?.evaluation?.evaluationTimestamp).toLocaleString(
                "zh-CN",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              ):''}
          </div>
            { getScoreColor(item?.evaluation?.qualityScore).includes('red')&&<div className="evaluation-mark-icon-bg score-red  bg-[url('/images/red.svg')]"><span>{(item?.evaluation?.qualityScore * 100).toFixed(0)} 分</span></div>}
            { getScoreColor(item?.evaluation?.qualityScore).includes('yellow')&&<div className="evaluation-mark-icon-bg score-yellow bg-[url('/images/yellow.svg')]"><span>{(item?.evaluation?.qualityScore * 100).toFixed(0)} 分</span></div>}
            { getScoreColor(item?.evaluation?.qualityScore).includes('green')&&<div className="evaluation-mark-icon-bg score-green bg-[url('/images/green.svg')]"><span>{(item?.evaluation?.qualityScore * 100).toFixed(0)} 分</span></div>}
        </section>
      ))}
    </>
  );
}
function KnowledgeBaseLink() {
  const [linkData, setLinkData] = useState<any>([])
  const toolCalls = useToolCalls();
useEffect(() => {
  // 1. 只从 toolCalls 里提取最新链接
  const newLinks: any[] = [];
  toolCalls.forEach(item => {
    if (item?.step && item?.result) {
      try {
        const arr = JSON.parse(item.result);
        if (Array.isArray(arr)) newLinks.push(...arr);
      } catch {}
    }
  });

  // 2. 与现有数据合并后统一去重
  setLinkData(prev => {
    const map = new Map<string, any>();
    // 先放旧数据
    prev.forEach(item => item.title && map.set(item.title, item));
    // 再放新数据，同名会被覆盖
    newLinks.forEach(item => item.title && map.set(item.title, item));
    const merged = Array.from(map.values());
    // 3. 真正变化才更新（可选优化）
    return merged.length === prev.length &&
           merged.every((v, i) => v.title === prev[i].title)
      ? prev
      : merged;
  });
}, [toolCalls]);
  if (linkData.length == 0) {
    return null
  }
  // 生成 markdown
  const markdownString = generateMarkdownFromLinkData(linkData);
  sessionStorage.setItem('knowledgeBaseLink', markdownString)
  return (
    <>
      <section className="mt-4 py-2">
        <div className="link-title bold text-[22px] font-bold">关键引用</div>
        <div className="link-content">
          {
            linkData.map((item: any, index: number) => {
              return (
                <div className="link-content-item flex items-center gap-2" key={item.title}>
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
      <hr className="my-8" />
    </>
  )
}
// 思考过程
function ThinkMessage({ messageId }: { messageId: string }) {
  const message:any = useMessage(messageId);
    const reasoningContent = message.reasoningContent;
  const hasMainContent = Boolean(
    message.content && message.content.trim() !== "",
  );
  // 判断是否正在思考：有推理内容但还没有主要内容
  const isThinking = Boolean(reasoningContent && !hasMainContent);
  if (reasoningContent) {
    return (
      <ThoughtBlock
          content={reasoningContent}
          isStreaming={isThinking}
        />
    )
  }
  return null;
}