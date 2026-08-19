// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

// 自定义写作风格 上传模版
import { useTranslations } from "next-intl";
import { forwardRef, useImperativeHandle, useState, useEffect, useRef,useCallback,useTransition } from "react";
import { Check, FileText, Newspaper, Users, GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  ScrollContainer,
  type ScrollContainerRef,
} from "~/components/deer-flow/scroll-container";
import { Markdown } from "~/components/deer-flow/markdown";
export interface ContentDialogRef {
  showDialog: () => void;
}



export const ContentDialog = forwardRef<ContentDialogRef>((props, ref) => {
  const t = useTranslations("settings.reportStyle");
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [chunks, setChunks] = useState<Array<{ content?: string; similarity?: string }>>([]);
  useImperativeHandle(ref, () => ({
    showDialog: (val?: any) => {
      if (val?.content || val?.chunks?.length) {
        setContent(val.content ?? '')
        setTitle(val.title)
        setChunks(Array.isArray(val.chunks) ? val.chunks : [])
        setOpen(true)
      }
    }
  }));
  const cancelDialog = () => {
    setOpen(false)
  }
     // 统一关闭回调
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);

    // 只要变成 false，就说明“要关了”
    if (!nextOpen) {
      cancelDialog()
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
                      <div className="flex h-150 w-full overflow-y-auto markdown-dialog">
                        <ScrollContainer
                          className={cn(
                            "flex h-full w-full flex-col overflow-hidden",
                          )}
                          scrollShadow={false}
                        >
                          {chunks.length > 0 ? (
                            <div className="px-4 py-2 space-y-4">
                              {chunks.map((chunk, index) => (
                                <div key={`${title}-${index}`} className="similarity-chunk">
                                  {chunk.similarity ? (
                                    <div className="similarity-badge">{chunk.similarity}</div>
                                  ) : null}
                                  <Markdown animated checkLinkCredibility>
                                    {chunk.content ?? ""}
                                  </Markdown>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="px-4 py-2">
                              <Markdown animated checkLinkCredibility>
                                {content}
                              </Markdown>
                            </div>
                          )}
                        </ScrollContainer>
                      </div>
      </DialogContent>
    </Dialog>
  );
});
