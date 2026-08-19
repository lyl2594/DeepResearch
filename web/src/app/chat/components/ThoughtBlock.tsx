// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useRef, useState, useEffect  } from "react";

import { Markdown } from "~/components/deer-flow/markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
export function ThoughtBlock({
  className,
  content,
  isStreaming,
  hasMainContent,
}: {
  className?: string;
  content: string;
  isStreaming?: boolean;
  hasMainContent?: boolean;
}) {
  const t = useTranslations("chat.research");
  const [isOpen, setIsOpen] = useState(true);
  const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);
  
  // 添加时间跟踪状态
  const [startTime, setStartTime] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);

  React.useEffect(() => {
    if (hasMainContent && !hasAutoCollapsed) {
      setIsOpen(false);
      setHasAutoCollapsed(true);
    }
  }, [hasMainContent, hasAutoCollapsed]);

  // 监控内容变化和思考状态
  useEffect(() => {
    // 当内容出现且正在思考时，开始计时
    if (content && content.trim() !== "" && isStreaming && !startTime) {
      setStartTime(Date.now());
    }
    
    // 当思考完成时，计算总时长
    if (content && content.trim() !== "" && !isStreaming && startTime) {
      const endTime = Date.now();
      const totalDuration = Math.round((endTime - startTime) / 1000); // 转换为秒
      setDuration(totalDuration);
      setStartTime(null); // 重置开始时间
    }
    
    // 当内容清空时，重置所有状态
    if (!content || content.trim() === "") {
      setStartTime(null);
      setDuration(0);
    }
  }, [content, isStreaming, startTime]);

  if (!content || content.trim() === "") {
    return null;
  }

  return (
    <div className={cn("mb-6 w-full", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center think-btn-wrapper">
            {/* 显示动态时间 */}
            <span>{isStreaming ? '思考中' : '思考已完成'} {duration > 0 ? `时长：${duration}s`:''}</span>
            {isOpen ? (
              <ChevronDown
                size={16}
                className="text-muted-foreground transition-transform duration-200"
              />
            ) : (
              <ChevronRight
                size={16}
                className="text-muted-foreground transition-transform duration-200"
              />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2 mt-3">
          <div className="flex w-full think-content-wrapper">
            <div className="bg-col_line01 absolute left-1 top-1 bottom-1 w-[0.5px]"></div>
            <Markdown
              className={cn(
                "prose dark:prose-invert max-w-none transition-colors duration-200  think-content-md",
                isStreaming ? "prose-primary" : "opacity-80",
              )}
              animated={isStreaming}
            >
              {content}
            </Markdown>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}