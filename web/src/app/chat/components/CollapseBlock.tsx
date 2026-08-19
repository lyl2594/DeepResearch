// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useRef, useState, useEffect  } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
export function CollapseBlock({
  className,
  content,
  title,
  children
}: {
  className?: string;
  content?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("chat.research");
  const [isOpen, setIsOpen] = useState(true);
  const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);
  
  // 自动折叠逻辑
  React.useEffect(() => {
    if (hasAutoCollapsed) {
      setIsOpen(false);
    }
  }, [hasAutoCollapsed]);

  return (
    <div className={cn("mb-6 w-full", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center collapse-btn-wrapper">
            <span>{title}</span>
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
          <div className="flex w-full collapse-content-wrapper">
            <div className="bg-col_line01 absolute left-1 top-1 bottom-1 w-[0.5px]"></div>
            {/* 优先使用 children，如果没有则显示 content 字符串 */}
            <div className="collapse-content-box">
                {children || (content && <div>{content}</div>)}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}