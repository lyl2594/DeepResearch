// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { MagicWandIcon } from "@radix-ui/react-icons";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Lightbulb, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Detective } from "~/components/deer-flow/icons/detective";
import MessageInput, {
  type MessageInputRef,
} from "~/components/deer-flow/message-input";
import { ReportStyleDialog } from "~/components/deer-flow/report-style-dialog";
import { CustomReportStyleDialog } from "~/components/deer-flow/custom-report-style-dialog";
import { Tooltip } from "~/components/deer-flow/tooltip";
import { BorderBeam } from "~/components/magicui/border-beam";
import { Button } from "~/components/ui/button";
import { enhancePrompt } from "~/core/api";
import { useConfig } from "~/core/api/hooks";
import type { Option, Resource } from "~/core/messages";
import {
  setEnableDeepThinking,
  setEnableWebSearch,
  useSettingsStore,
  setEnableRAG,
} from "~/core/store";
import { cn, getReportStyleTitleById } from "~/lib/utils";

export function InputBoxHome({
  className,
  responding,
  feedback,
  onSend,
  onCancel,
  onRemoveFeedback,
}: {
  className?: string;
  size?: "large" | "normal";
  responding?: boolean;
  feedback?: { option: Option } | null;
  onSend?: (
    message: string,
    options?: {
      interruptFeedback?: string;
      resources?: Array<Resource>;
    },
  ) => void;
  onCancel?: () => void;
  onRemoveFeedback?: () => void;
}) {
  const customReportStyleDialogRef = useRef<any>(null);
  const t = useTranslations("chat.inputBox");
  const tCommon = useTranslations("common");
  const enableDeepThinking = useSettingsStore(
    (state) => state.general.enableDeepThinking,
  );
  const enableWebSearch = useSettingsStore(
    (state) => state.general.enableWebSearch,
  );
  const enableRAG = useSettingsStore(
    (state) => state.general.enableRAG,
  );
  const { config, loading } = useConfig();
  const reportStyle = useSettingsStore((state) => state.general.reportStyle);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<MessageInputRef>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Enhancement state
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isEnhanceAnimating, setIsEnhanceAnimating] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [updateTime, setUpdateTime] = useState('')
  // const handleSendMessage = useCallback(
  //   (message: string, resources: Array<Resource>) => {
  //     if (responding) {
  //       onCancel?.();
  //     } else {
  //       if (message.trim() === "") {
  //         return;
  //       }
  //       if (onSend) {
  //         onSend(message, {
  //           interruptFeedback: feedback?.option.value,
  //           resources,
  //         });
  //         onRemoveFeedback?.();
  //         // Clear enhancement animation after sending
  //         setIsEnhanceAnimating(false);
  //       }
  //     }
  //   },
  //   [responding, onCancel, onSend, feedback, onRemoveFeedback],
  // );

  const handleEnhancePrompt = useCallback(async () => {
    if (currentPrompt.trim() === "" || isEnhancing) {
      return;
    }

    setIsEnhancing(true);
    setIsEnhanceAnimating(true);

    try {
      const enhancedPrompt = await enhancePrompt({
        prompt: currentPrompt,
        report_style: getReportStyleTitleById(reportStyle),
      });

      // Add a small delay for better UX
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update the input with the enhanced prompt with animation
      if (inputRef.current) {
        inputRef.current.setContent(enhancedPrompt);
        setCurrentPrompt(enhancedPrompt);
      }

      // Keep animation for a bit longer to show the effect
      setTimeout(() => {
        setIsEnhanceAnimating(false);
      }, 1000);
    } catch (error) {
      console.error("Failed to enhance prompt:", error);
      setIsEnhanceAnimating(false);
      // Could add toast notification here
    } finally {
      setIsEnhancing(false);
    }
  }, [currentPrompt, isEnhancing, reportStyle]);

  // 调用方法 显示自定义弹框
  const handleCustomReportStyle = (val: any) => {
    customReportStyleDialogRef?.current?.showDialog(val);
  }
  const handleUpdateStyle = () => {
    setUpdateTime(new Date().getTime() + '')
  }
  const goPage = () => {
    localStorage.setItem('homeInputVal', inputRef?.current?.getContent())
    window.location.href = '/chat'
  }
  return (
    <div className="w-full h-full">
      <div
        className={cn(
          "bg-card relative flex h-full w-full flex-col rounded-[24px] border",
          className,
        )}
        ref={containerRef}
      >
        <div className="w-full h-full">
          <AnimatePresence>
            {feedback && (
              <motion.div
                ref={feedbackRef}
                className="bg-background border-brand absolute top-0 left-0 mt-2 ml-4 flex items-center justify-center gap-1 rounded-2xl border px-2 py-0.5"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <div className="text-brand flex h-full w-full items-center justify-center text-sm opacity-90">
                  {feedback.option.text}
                </div>
                <X
                  className="cursor-pointer opacity-60"
                  size={16}
                  onClick={onRemoveFeedback}
                />
              </motion.div>
            )}
            {isEnhanceAnimating && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="relative h-full w-full">
                  {/* Sparkle effect overlay */}
                  <motion.div
                    className="absolute inset-0 rounded-[24px] bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10"
                    animate={{
                      background: [
                        "linear-gradient(45deg, rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1), rgba(59, 130, 246, 0.1))",
                        "linear-gradient(225deg, rgba(147, 51, 234, 0.1), rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1))",
                        "linear-gradient(45deg, rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1), rgba(59, 130, 246, 0.1))",
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  {/* Floating sparkles */}
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute h-2 w-2 rounded-full bg-blue-400"
                      style={{
                        left: `${20 + i * 12}%`,
                        top: `${30 + (i % 2) * 40}%`,
                      }}
                      animate={{
                        y: [-10, -20, -10],
                        opacity: [0, 1, 0],
                        scale: [0.5, 1, 0.5],
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        delay: i * 0.2,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <MessageInput
            className={cn(
              "h-full px-4 pt-5",
              feedback && "pt-9",
              isEnhanceAnimating && "transition-all duration-500",
            )}
            ref={inputRef}
            loading={loading}
            config={config}
            onEnter={goPage}
            onChange={setCurrentPrompt}
          />
        </div>
        {isEnhancing && (
          <>
            <BorderBeam
              duration={5}
              size={250}
              className="from-transparent via-red-500 to-transparent"
            />
            <BorderBeam
              duration={5}
              delay={3}
              size={250}
              className="from-transparent via-blue-500 to-transparent"
            />
          </>
        )}
      </div>
      <div className="flex items-center px-4 py-2">
        <div className="flex grow gap-2">
          {config?.models.reasoning?.[0] && (
            <Tooltip
              className="max-w-60"
              title={
                <div>
                  <h3 className="mb-2 font-bold">
                    {t("deepThinkingTooltip.title", {
                      status: enableDeepThinking ? t("on") : t("off"),
                    })}
                  </h3>
                  <p>
                    {t("deepThinkingTooltip.description", {
                      model: config.models.reasoning?.[0] ?? "",
                    })}
                  </p>
                </div>
              }
            >
              <Button
                className={cn(
                  "rounded-2xl",
                  enableDeepThinking && "!border-brand !text-brand",
                )}
                variant="outline"
                onClick={() => {
                  setEnableDeepThinking(!enableDeepThinking);
                }}
              >
                <Lightbulb /> {t("deepThinking")}
              </Button>
            </Tooltip>
          )}

          <Tooltip
            className="max-w-60"
            title={
              <div>
                <h3 className="mb-2 font-bold">
                  {t("webSearchTooltip.title", {
                    status: enableWebSearch ? t("on") : t("off"),
                  })}
                </h3>
                <p>{t("webSearchTooltip.description")}</p>
              </div>
            }
          >
            <Button
              className={cn(
                "rounded-2xl",
                enableWebSearch && "!border-brand !text-brand",
              )}
              variant="outline"
              onClick={() => setEnableWebSearch(!enableWebSearch)}
            >
              <Search className="mr-1 h-4 w-4" /> {t("webSearch")}
            </Button>
          </Tooltip>
          <Tooltip
            className="max-w-60"
            title={
              <div>
                <h3 className="mb-2 font-bold">
                  {t("ragTooltip.title", {
                    status: enableRAG ? t("on") : t("off"),
                  })}
                </h3>
                <p className="mb-1">{t("ragTooltip.description")}</p>
              </div>
            }
          >
            <Button
              className={cn(
                "rounded-2xl",
                enableRAG && "!border-brand !text-brand",
              )}
              variant="outline"
              onClick={() =>
                setEnableRAG(!enableRAG)
              }
            >
              <Detective /> RAG
            </Button>
          </Tooltip>
          <ReportStyleDialog onCustomStyleClick={handleCustomReportStyle} updateTime={updateTime} />
          <CustomReportStyleDialog ref={customReportStyleDialogRef} onUpdateClick={handleUpdateStyle} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip title={t("enhancePrompt")}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "hover:bg-accent h-10 w-10 home-polishing-box",
                isEnhancing && "animate-pulse",
              )}
              onClick={handleEnhancePrompt}
              disabled={isEnhancing || currentPrompt.trim() === ""}
            >
              {isEnhancing ? (
                <div className="flex h-10 w-10 items-center justify-center">
                  <div className="bg-foreground h-3 w-3 animate-bounce rounded-full opacity-70" />
                </div>
              ) : (
                // <MagicWandIcon className="text-brand" />
                <div className="home-polishing-wrapper">
                  <img className="home-polishing-img" src="/images/runse.png" />
                  <span className="home-polishing-txt">优化</span>
                </div>
              )}
            </Button>
          </Tooltip>
          <Tooltip title={responding ? tCommon("stop") : tCommon("send")}>
            <Button
              variant="outline"
              size="icon"
              className={cn("h-10 w-10 rounded-full home-send-box")}
              onClick={goPage}
            >

              {/* <Link
                              target="_blank"
                              href="/chat"
                            > */}
              <div className="home-send-wrapper">
                <img className="home-send-img" src="/images/send.png" />
                <span className="home-send-txt">发送</span>
              </div>
              {/* </Link> */}

            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
