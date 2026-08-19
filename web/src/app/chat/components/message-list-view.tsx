// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { LoadingOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import {
  Download,
  Headphones,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useRef, useState, useEffect  } from "react";

import { LoadingAnimation } from "~/components/deer-flow/loading-animation";
import { Markdown } from "~/components/deer-flow/markdown";
import { RainbowText } from "~/components/deer-flow/rainbow-text";
import { RollingText } from "~/components/deer-flow/rolling-text";
import {
  ScrollContainer,
  type ScrollContainerRef,
} from "~/components/deer-flow/scroll-container";
import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import type { Message, Option } from "~/core/messages";
import {
  closeResearch,
  openResearch,
  useLastFeedbackMessageId,
  useLastInterruptMessage,
  useMessage,
  useMessageIds,
  useResearchMessage,
  useStore,
} from "~/core/store";
import { parseJSON } from "~/core/utils";
import { cn } from "~/lib/utils";
import TiptapEditor from "./MarkdownEditor";
import { ThoughtBlock } from './ThoughtBlock'

interface PlanInterface {
    title?: string;
    thought?: string;
    steps?: { title?: string; description?: string; tools?: string[] }[];
}
export function MessageListView({
  className,
  onFeedback,
  onSendMessage,
}: {
  className?: string;
  onFeedback?: (feedback: { option: Option }) => void;
  onSendMessage?: (
    message: string,
    options?: { interruptFeedback?: string },
  ) => void;
}) {
  const scrollContainerRef = useRef<ScrollContainerRef>(null);
  const messageIds = useMessageIds();
  const interruptMessage = useLastInterruptMessage();
  const waitingForFeedbackMessageId = useLastFeedbackMessageId();
  const responding = useStore((state) => state.responding);
  const noOngoingResearch = useStore(
    (state) => state.ongoingResearchId === null,
  );
  const ongoingResearchIsOpen = useStore(
    (state) => state.ongoingResearchId === state.openResearchId,
  );

  const handleToggleResearch = useCallback(() => {
    // Fix the issue where auto-scrolling to the bottom
    // occasionally fails when toggling research.
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollToBottom();
      }
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <ScrollContainer
      className={cn("flex h-full w-full flex-col overflow-hidden", className)}
      scrollShadowColor="var(--app-background)"
      autoScrollToBottom
      ref={scrollContainerRef}
    >
      <ul className="flex flex-col">
        {messageIds.map((messageId) => (
          <MessageListItem
            key={messageId}
            messageId={messageId}
            waitForFeedback={waitingForFeedbackMessageId === messageId}
            interruptMessage={interruptMessage}
            onFeedback={onFeedback}
            onSendMessage={onSendMessage}
            onToggleResearch={handleToggleResearch}
          />
        ))}
        <div className="flex h-8 w-full shrink-0"></div>
      </ul>
      {responding && (noOngoingResearch || !ongoingResearchIsOpen) && (
        <LoadingAnimation className="ml-4" />
      )}
    </ScrollContainer>
  );
}

function MessageListItem({
  className,
  messageId,
  waitForFeedback,
  interruptMessage,
  onFeedback,
  onSendMessage,
  onToggleResearch,
}: {
  className?: string;
  messageId: string;
  waitForFeedback?: boolean;
  onFeedback?: (feedback: { option: Option }) => void;
  interruptMessage?: Message | null;
  onSendMessage?: (
    message: string,
    options?: { interruptFeedback?: string },
  ) => void;
  onToggleResearch?: () => void;
}) {
  const message = useMessage(messageId);
  const researchIds = useStore((state) => state.researchIds);
  const startOfResearch = useMemo(() => {
    return researchIds.includes(messageId);
  }, [researchIds, messageId]);
  if (message) {
    if (
      message.role === "user" ||
      message.agent === "coordinator" ||
      message.agent === "planner" ||
      message.agent === "podcast" ||
      startOfResearch
    ) {
      if (message.agent == 'final_report_evaluator') {
        return null;
      }
      let content: React.ReactNode;
      if (message.agent === "planner") {
        content = (
          <div className="w-full px-4">
            <PlanCard
              message={message}
              waitForFeedback={waitForFeedback}
              interruptMessage={interruptMessage}
              onFeedback={onFeedback}
              onSendMessage={onSendMessage}
            />
          </div>
        );
      } else if (message.agent === "podcast") {
        content = (
          <div className="w-full px-4">
            <PodcastCard message={message} />
          </div>
        );
      } else if (startOfResearch) {
        content = (
          <div className="w-full px-4">
            <ResearchCard
              researchId={message.id}
              onToggleResearch={onToggleResearch}
            />
          </div>
        );
      } else {

        content = message.content ? (
          <div
            className={cn(
              "flex w-full px-4",
              message.role === "user" && "justify-end",
              className,
            )}
          >
            <MessageBubble message={message}>
              <div className="flex w-full flex-col break-words">
                <Markdown
                  className={cn(
                    message.role === "user" &&
                    "prose-invert not-dark:text-secondary dark:text-inherit",
                  )}
                >
                  {message?.content}
                </Markdown>
              </div>
            </MessageBubble>
          </div>
        ) : null;
      }
      if (content) {
        // 避免出现空白行
        if( message.role == 'assistant'&& message.agent== 'coordinator' && message.content == '\n\n'){
         return null
        }
        return (
          <motion.li
            className="mt-10"
            key={messageId}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ transition: "all 0.2s ease-out" }}
            transition={{
              duration: 0.2,
              ease: "easeOut",
            }}
          >
            {content}
          </motion.li>
        );
      }
    }
    return null;
  }
}

function MessageBubble({
  className,
  message,
  children,
}: {
  className?: string;
  message: Message;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex w-auto max-w-[90vw] flex-col rounded-2xl px-4 py-3 break-words",
        message.role === "user" && "bg-brand rounded-ee-none",
        message.role === "assistant" && "bg-card rounded-es-none",
        className,
      )}
      style={{ wordBreak: "break-all" }}
    >
      {children}
    </div>
  );
}

function ResearchCard({
  className,
  researchId,
  onToggleResearch,
}: {
  className?: string;
  researchId: string;
  onToggleResearch?: () => void;
}) {
  const messages = useStore((state) => state.messages);
  const t = useTranslations("chat.research");
  const reportId = useStore((state) => state.researchReportIds.get(researchId));
  const hasReport = reportId !== undefined;
  const reportGenerating = useStore(
    (state) => hasReport && state.messages.get(reportId)!.isStreaming,
  );
  const openResearchId = useStore((state) => state.openResearchId);
  const finallyReports = useMemo(
    () =>
      Array.from(messages.values()).filter(
        (v) => v?.agent === 'final_report_evaluator'
      ),
    [messages]
  );
  const state = useMemo(() => {
    if (hasReport) {
      return !reportGenerating && finallyReports.length > 0 ? t("reportGenerated") : t("generatingReport");
    }
    return t("researching");
  }, [hasReport, reportGenerating, finallyReports.length, t]);
  const msg = useResearchMessage(researchId);
  const title = useMemo(() => {
    if (msg) {
      return parseJSON(msg.content ?? "", { title: "" }).title;
    }
    return undefined;
  }, [msg]);
  const handleOpen = useCallback(() => {
    if (openResearchId === researchId) {
      closeResearch();
    } else {
      openResearch(researchId);
    }
    onToggleResearch?.();
  }, [openResearchId, researchId, onToggleResearch]);
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>
          <RainbowText animated={state !== t("reportGenerated")}>
            {title !== undefined && title !== "" ? title : t("deepResearch")}
          </RainbowText>
        </CardTitle>
      </CardHeader>
      <CardFooter>
        <div className="flex w-full">
          <RollingText className="text-muted-foreground flex-grow text-sm">
            {state}
          </RollingText>
          <Button
            variant={!openResearchId ? "default" : "outline"}
            onClick={handleOpen}
          >
            {researchId !== openResearchId ? t("open") : t("close")}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// export function ThoughtBlock({
//   className,
//   content,
//   isStreaming,
//   hasMainContent,
// }: {
//   className?: string;
//   content: string;
//   isStreaming?: boolean;
//   hasMainContent?: boolean;
// }) {
//   const t = useTranslations("chat.research");
//   const [isOpen, setIsOpen] = useState(true);

//   const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);

//   React.useEffect(() => {
//     if (hasMainContent && !hasAutoCollapsed) {
//       setIsOpen(false);
//       setHasAutoCollapsed(true);
//     }
//   }, [hasMainContent, hasAutoCollapsed]);

//   if (!content || content.trim() === "") {
//     return null;
//   }

//   return (
//     <div className={cn("mb-6 w-full", className)}>
//       <Collapsible open={isOpen} onOpenChange={setIsOpen}>
//         <CollapsibleTrigger asChild>
//           <Button
//             variant="ghost"
//             className={cn(
//               "h-auto w-full justify-start rounded-xl border px-6 py-4 text-left transition-all duration-200",
//               "hover:bg-accent hover:text-accent-foreground",
//               isStreaming
//                 ? "border-primary/20 bg-primary/5 shadow-sm"
//                 : "border-border bg-card",
//             )}
//           >
//             <div className="flex w-full items-center gap-3">
//               <Lightbulb
//                 size={18}
//                 className={cn(
//                   "shrink-0 transition-colors duration-200",
//                   isStreaming ? "text-primary" : "text-muted-foreground",
//                 )}
//               />
//               <span
//                 className={cn(
//                   "leading-none font-semibold transition-colors duration-200",
//                   isStreaming ? "text-primary" : "text-foreground",
//                 )}
//               >
//                 {t("deepThinking")}
//               </span>
//               {isStreaming && <LoadingAnimation className="ml-2 scale-75" />}
//               <div className="flex-grow" />
//               {isOpen ? (
//                 <ChevronDown
//                   size={16}
//                   className="text-muted-foreground transition-transform duration-200"
//                 />
//               ) : (
//                 <ChevronRight
//                   size={16}
//                   className="text-muted-foreground transition-transform duration-200"
//                 />
//               )}
//             </div>
//           </Button>
//         </CollapsibleTrigger>
//         <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2 mt-3">
//           <Card
//             className={cn(
//               "transition-all duration-200",
//               isStreaming ? "border-primary/20 bg-primary/5" : "border-border",
//             )}
//           >
//             <CardContent>
//               <div className="flex h-40 w-full overflow-y-auto">
//                 <ScrollContainer
//                   className={cn(
//                     "flex h-full w-full flex-col overflow-hidden",
//                     className,
//                   )}
//                   scrollShadow={false}
//                   autoScrollToBottom
//                 >
//                   <Markdown
//                     className={cn(
//                       "prose dark:prose-invert max-w-none transition-colors duration-200",
//                       isStreaming ? "prose-primary" : "opacity-80",
//                     )}
//                     animated={isStreaming}
//                   >
//                     {content}
//                   </Markdown>
//                 </ScrollContainer>
//               </div>
//             </CardContent>
//           </Card>
//         </CollapsibleContent>
//       </Collapsible>
//     </div>
//   );
// }
let newPlanData = {};
const GREETINGS = ["Cool", "Sounds great", "Looks good", "Great", "Awesome"];
function PlanCard({
  className,
  message,
  interruptMessage,
  onFeedback,
  waitForFeedback,
  onSendMessage,
}: {
  className?: string;
  message: Message;
  interruptMessage?: Message | null;
  onFeedback?: (feedback: { option: Option }) => void;
  onSendMessage?: (
    message: string,
    options?: { interruptFeedback?: string, plan?:PlanInterface },
  ) => void;
  waitForFeedback?: boolean;
}) {
  const [isEdit, setIsEdit] = useState(false); // 是否显示编辑
  const t = useTranslations("chat.plan");
  const plan = useMemo<{
    title?: string;
    thought?: string;
    steps?: { title?: string; description?: string; tools?: string[] }[];
  }>(() => {
    return parseJSON(message.content ?? "", {});
  }, [message.content]);

  // 创建编辑器引用数组，每个TiptapEditor一个引用
  const editorRefs = useRef<(React.RefObject<any>)[]>([]);
  
  // 初始化编辑器引用
  useEffect(() => {
    if (plan.steps) {
      // 主内容编辑器引用 + 步骤编辑器引用 (每个步骤3个字段: title, description)
      const totalEditors = 1 + (plan.steps.length * 3);
      editorRefs.current = Array.from({ length: totalEditors }, () => React.createRef());
    }
  }, [plan.steps]);

  const reasoningContent = message.reasoningContent;
  const hasMainContent = Boolean(
    message.content && message.content.trim() !== "",
  );

  // 判断是否正在思考：有推理内容但还没有主要内容
  const isThinking = Boolean(reasoningContent && !hasMainContent);

  // 判断是否应该显示计划：有主要内容就显示（无论是否还在流式传输）
  const shouldShowPlan = hasMainContent;

  // 保存编辑状态，用于取消编辑时恢复
  const [savedContent, setSavedContent] = useState<{
    thought?: string;
    steps?: { title?: string; description?: string; tools?: string[] }[];
  } | null>(null);

  const handleAccept = useCallback(async () => {
    if (onSendMessage) {
      onSendMessage(
        `${GREETINGS[Math.floor(Math.random() * GREETINGS.length)]}! ${Math.random() > 0.5 ? "Let's get started." : "Let's start."}`,
        {
          interruptFeedback: "accepted",
          plan: newPlanData,
        },
      );
    }
  }, [onSendMessage]);

  // 开始编辑时保存当前内容
  const startEdit = useCallback(() => {
    setSavedContent({
      thought: plan.thought,
      steps: plan.steps ? [...plan.steps] : [],
    });
    setIsEdit(true);
  }, [plan]);

  // 取消编辑，恢复之前保存的内容
  const cancelEdit = useCallback(() => {
    setIsEdit(false);
    // 恢复编辑器内容
    if (savedContent && editorRefs.current.length > 0) {
      // 恢复主内容
      if (editorRefs.current[0]?.current) {
        editorRefs.current[0].current.setContent(savedContent.thought || "");
      }

      // 恢复步骤内容
      savedContent.steps?.forEach((step, stepIndex) => {
        const titleRefIndex = 1 + (stepIndex * 3);
        const descRefIndex = 1 + (stepIndex * 3) + 1;

        if (editorRefs.current[titleRefIndex]?.current) {
          editorRefs.current[titleRefIndex].current.setContent(step.title || "");
        }

        if (editorRefs.current[descRefIndex]?.current) {
          editorRefs.current[descRefIndex].current.setContent(step.description || "");
        }
      });
    }
    setSavedContent(null);
  }, [savedContent]);

  // 保存编辑，获取所有编辑器内容
const saveEdit = useCallback(() => {
  // 构建新的计划对象
  const newPlan: {
    title?: string;
    thought?: string;
    steps?: { title?: string; description?: string; tools?: string[] }[];
  } = {
    title: plan.title,
    thought: editorRefs.current[0]?.current?.getContent() || "",
    steps: plan.steps?.map((step, index) => {
      const titleRefIndex = 1 + (index * 3);
      const descRefIndex = 1 + (index * 3) + 1;

      return {
        title: editorRefs.current[titleRefIndex]?.current?.getContent() || "",
        description: editorRefs.current[descRefIndex]?.current?.getContent() || "",
        tools: step.tools,
      };
    }),
  };
 
  // 更新store中的消息内容
  const updatedMessage = {
    ...message,
    content: JSON.stringify(newPlan)
  };
  
  // 使用store的updateMessage方法更新消息
  useStore.getState().updateMessage(updatedMessage);
  
  // 保存到newPlanData供后续使用
  newPlanData = newPlan;
  setIsEdit(false);
  setSavedContent(null);
}, [plan, message]);

  // 修改渲染部分的代码
  return (
    <div className={cn("w-full", className)}>
      {reasoningContent && (
        <ThoughtBlock
          content={reasoningContent}
          isStreaming={isThinking}
          hasMainContent={hasMainContent}
        />
      )}
      {shouldShowPlan && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <Card className="w-full">
            <CardHeader>
              <CardTitle>
                <Markdown animated={message.isStreaming}>
                  {`### ${plan.title !== undefined && plan.title !== ""
                    ? plan.title
                    : t("deepResearch")
                    }`}
                </Markdown>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                {!isEdit ? (
                  <Markdown className="opacity-80" animated={message.isStreaming}>
                    {plan.thought}
                  </Markdown>
                ) : (
                  <TiptapEditor 
                    ref={editorRefs.current[0]} 
                    defaultValue={plan.thought}
                    syncWithDefaultValue={false} // 编辑时不自动同步
                  />
                )}
                {plan.steps && (
                  <ul className="my-2 flex list-decimal flex-col gap-4 border-l-[2px] pl-8">
                    {plan.steps.map((step, i) => (
                      <li key={`step-${i}`} style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <h3 className="mb flex items-center gap-2 text-lg font-medium">
                              {!isEdit ? (
                                <Markdown animated={message.isStreaming}>
                                  {step.title}
                                </Markdown>
                              ) : (
                                <TiptapEditor 
                                  ref={editorRefs.current[1 + (i * 3)]}
                                  defaultValue={step.title}
                                  syncWithDefaultValue={false} // 编辑时不自动同步
                                />
                              )}
                              {step.tools && step.tools.length > 0 && (
                                <Tooltip
                                  title={`Uses ${step.tools.length} MCP tool${step.tools.length > 1 ? "s" : ""}`}
                                >
                                  <div className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">
                                    <Wrench size={12} />
                                    <span>{step.tools.length}</span>
                                  </div>
                                </Tooltip>
                              )}
                            </h3>
                            <div className="text-muted-foreground text-sm" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                              {!isEdit ? (
                                <Markdown animated={message.isStreaming}>
                                  {step.description}
                                </Markdown>
                              ) : (
                                <TiptapEditor 
                                  ref={editorRefs.current[1 + (i * 3) + 1]}
                                  defaultValue={step.description}
                                  syncWithDefaultValue={false} // 编辑时不自动同步
                                />
                              )}
                            </div>
                            {step.tools && step.tools.length > 0 && (
                              <ToolsDisplay tools={step.tools} />
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              {!message.isStreaming && interruptMessage?.options?.length && (
                <motion.div
                  className="flex gap-2"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 }}
                >
                  {!isEdit ? (
                    <Button variant="outline" onClick={startEdit} disabled={!waitForFeedback}>
                      {t("directEditPlan")}
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" onClick={cancelEdit}>
                        {t("cancelEdit")}
                      </Button>
                      <Button variant="outline" onClick={saveEdit}>
                        {t("saveEdit")}
                      </Button>
                    </>
                  )}
                  {interruptMessage?.options.map((option) => (
                    <Button
                      key={option.value}
                      variant={
                        option.value === "accepted" ? "default" : "outline"
                      }
                      disabled={!waitForFeedback}
                      onClick={() => {
                        if (option.value === "accepted") {
                          void handleAccept();
                        } else {
                          onFeedback?.({
                            option,
                          });
                        }
                      }}
                    >
                      {option.text}
                    </Button>
                  ))}
                </motion.div>
              )}
            </CardFooter>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function PodcastCard({
  className,
  message,
}: {
  className?: string;
  message: Message;
}) {
  const data = useMemo(() => {
    return JSON.parse(message.content ?? "");
  }, [message.content]);
  const title = useMemo<string | undefined>(() => data?.title, [data]);
  const audioUrl = useMemo<string | undefined>(() => data?.audioUrl, [data]);
  const isGenerating = useMemo(() => {
    return message.isStreaming;
  }, [message.isStreaming]);
  const hasError = useMemo(() => {
    return data?.error !== undefined;
  }, [data]);
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <Card className={cn("w-[508px]", className)}>
      <CardHeader>
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            {isGenerating ? <LoadingOutlined /> : <Headphones size={16} />}
            {!hasError ? (
              <RainbowText animated={isGenerating}>
                {isGenerating
                  ? "Generating podcast..."
                  : isPlaying
                    ? "Now playing podcast..."
                    : "Podcast"}
              </RainbowText>
            ) : (
              <div className="text-red-500">
                Error when generating podcast. Please try again.
              </div>
            )}
          </div>
          {!hasError && !isGenerating && (
            <div className="flex">
              <Tooltip title="Download podcast">
                <Button variant="ghost" size="icon" asChild>
                  <a
                    href={audioUrl}
                    download={`${(title ?? "podcast").replaceAll(" ", "-")}.mp3`}
                  >
                    <Download size={16} />
                  </a>
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
        <CardTitle>
          <div className="text-lg font-medium">
            <RainbowText animated={isGenerating}>{title}</RainbowText>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {audioUrl ? (
          <audio
            className="w-full"
            src={audioUrl}
            controls
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="w-full"></div>
        )}
      </CardContent>
    </Card>
  );
}

function ToolsDisplay({ tools }: { tools: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tools.map((tool, index) => (
        <span
          key={index}
          className="rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground"
        >
          {tool}
        </span>
      ))}
    </div>
  );
}
