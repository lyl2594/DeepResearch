// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { Check, Copy, Headphones, Pencil, Undo2, X, Download, FileText, FileCode, FileType } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import MarkdownIt from 'markdown-it';

import { ScrollContainer } from "~/components/deer-flow/scroll-container";
import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useReplay } from "~/core/replay";
import { closeResearch, listenToPodcast, useStore } from "~/core/store";
import { resolveServiceURL } from "~/core/api/resolve-service-url";
import { cn } from "~/lib/utils";
import { SkipForward } from "lucide-react";

import { ResearchActivitiesBlock } from "./research-activities-block";
import { ResearchReportBlock } from "./research-report-block";
import HtmlDownDialog from "./HtmlDownDialog";
import { processContent } from "~/core/utils/markdown"

export function ResearchBlock({
  className,
  researchId = null,
}: {
  className?: string;
  researchId: string | null;
}) {
  const dialogRef = useRef<any>(null);
  const t = useTranslations("chat.research");
  const messages = useStore((state) => state.messages);
  const researchActivityIds = useStore((state) => state.researchActivityIds);
  const activityIds = useMemo(
    () => (researchId ? (researchActivityIds.get(researchId) ?? []) : []),
    [researchActivityIds, researchId],
  );
  const reportId = useStore((state) =>
    researchId ? state.researchReportIds.get(researchId) : undefined,
  );
  const [activeTab, setActiveTab] = useState("activities");
  const hasReport = useStore((state) =>
    researchId ? state.researchReportIds.has(researchId) : false,
  );
  const reportStreaming = useStore((state) =>
    reportId ? (state.messages.get(reportId)?.isStreaming ?? false) : false,
  );
  const { isReplay } = useReplay();

  // 获取研究状态
  const ongoingResearchId = useStore((state) => state.ongoingResearchId);
  const threadId = useStore((state) => state.threadId);

  // 处理跳过执行的函数
  const [skipButtonText, setSkipButtonText] = useState("跳过执行");

  // 判断是否应该显示跳过按钮
  const showSkipButton = useMemo(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('thread_id')) {
      return false;
    }
    const currentMessages = activityIds.flatMap((id) => {
      const message = messages.get(id);
      return message ? [message] : [];
    });
    const hasReporter = currentMessages.some(msg => msg.agent === 'reporter');
    const lastMessage = [...currentMessages]
      .reverse()
      .find((message) =>
        ["researcher", "eval", "reporter"].includes(message.agent || ""),
      );
    const showButton =
      lastMessage?.agent === "researcher" &&
      Number(lastMessage?.additional_info?.re_execute_times || 0) > 0;
    if (showButton && !hasReporter) {
      return true
    }
    return false;
  }, [activityIds, messages]);
  useEffect(() => {
    if (!showSkipButton) {
      setSkipButtonText("跳过执行");
    }
  }, [showSkipButton]);
  const [checkpointId, setCheckpointId] = useState('');
  useEffect(() => {
    messages.forEach((value, key) => {
      if (
        value &&
        value.agent === 'final_report_evaluator' && value.checkpoint_id
      ) {
        setCheckpointId(value.checkpoint_id)
      }
    });
  }, [messages]);
  useEffect(() => {
    if (hasReport) {
      setActiveTab("report");
    }
  }, [hasReport]);

  const handleGeneratePodcast = useCallback(async () => {
    if (!researchId) {
      return;
    }
    await listenToPodcast(researchId);
  }, [researchId]);

  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    void navigator.clipboard.writeText(report.content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1000);
  }, [reportId]);

  // Download report as markdown
  const handleDownloadMarkdown = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    let reportContent = processContent(report.content);
    // 手动拼接 关键引用
    if (sessionStorage.getItem('knowledgeBaseLink')) {
      reportContent += sessionStorage.getItem('knowledgeBaseLink')
    }
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `research-report-${timestamp}.md`;
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }, [reportId]);

  // Markdown to HTML conversion function with beautiful styling
  const markdownToHTML = (markdown: string): string => {
    // 创建 markdown-it 实例，启用常用插件
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true
    });

    // 将 markdown 转换为 HTML
    const convertedHTML = md.render(markdown);

    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>研究报告</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .header .timestamp {
            opacity: 0.9;
            font-size: 1rem;
        }
        .content {
            padding: 40px;
        }
        .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
            color: #4f46e5;
            margin: 30px 0 15px 0;
            font-weight: 600;
        }
        .content h1 {
            font-size: 2rem;
            border-bottom: 3px solid #4f46e5;
            padding-bottom: 10px;
        }
        .content h2 {
            font-size: 1.5rem;
        }
        .content h3 {
            font-size: 1.25rem;
        }
        .content p {
            margin-bottom: 16px;
            font-size: 1.1rem;
            color: #555;
        }
        .content ul, .content ol {
            margin: 16px 0;
            padding-left: 30px;
        }
        .content li {
            margin-bottom: 8px;
        }
        .content blockquote {
            border-left: 4px solid #4f46e5;
            padding-left: 20px;
            margin: 20px 0;
            background: #f8fafc;
            padding: 20px;
            border-radius: 0 8px 8px 0;
            font-style: italic;
        }
        .content code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
        }
        .content pre {
            background: #1e293b;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 20px 0;
        }
        .content pre code {
            background: none;
            padding: 0;
            color: inherit;
        }
        .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .content th, .content td {
            padding: 12px;
            text-align: left;
            border: 1px solid #e2e8f0;
        }
        .content th {
            background: #4f46e5;
            color: white;
            font-weight: 600;
        }
        .content tr:nth-child(even) {
            background: #f8fafc;
        }
        .content a {
            color: #4f46e5;
            text-decoration: none;
        }
        .content a:hover {
            text-decoration: underline;
        }
        .content img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 10px 0;
        }
        .content strong {
            font-weight: 600;
            color: #4f46e5;
        }
        .content em {
            font-style: italic;
        }
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8fafc;
            color: #64748b;
            font-size: 0.9rem;
        }
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            .header h1 {
                font-size: 2rem;
            }
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>研究报告</h1>
            <div class="timestamp">生成时间: ${new Date().toLocaleString('zh-CN')}</div>
        </div>
        <div class="content">
            ${convertedHTML}
        </div>
        <div class="footer">
            本报告由 深思 生成
        </div>
    </div>
</body>
</html>`;
    return htmlContent;
  };

  // Download report as HTML
  const handleDownloadHTML = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    let reportContent = processContent(report.content);
    // 手动拼接 关键引用
    if (sessionStorage.getItem('knowledgeBaseLink')) {
      reportContent += sessionStorage.getItem('knowledgeBaseLink')
    }
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `research-report-${timestamp}.html`;
    const htmlContent = markdownToHTML(reportContent);
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }, [reportId]);

  const onShowDownloadDrawer = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report || !report.threadId) {
      return;
    }
    dialogRef.current?.showDialog();
  }, [reportId]);

  const handleEdit = useCallback(() => {
    setEditing((editing) => !editing);
  }, []);



  const handleSkipExecution = useCallback(async () => {
    if (!threadId) {
      return;
    }
    setSkipButtonText("正在跳过...");
    try {
      const response = await fetch(resolveServiceURL("/api/chat/skip"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thread_id: threadId,
        }),
      });

      if (!response.ok) {
        console.error("跳过执行失败:", response.statusText);
        setSkipButtonText("跳过失败，请重试");
      } else {
        setSkipButtonText("已请求跳过");
      }
    } catch (error) {
      console.error("跳过执行出错:", error);
      setSkipButtonText("跳过失败，请重试");
    }
  }, [threadId]);

  // When the research id changes, set the active tab to activities
  useEffect(() => {
    if (!hasReport) {
      setActiveTab("activities");
    }
  }, [hasReport, researchId]);

  return (
    <div className={cn("h-full w-full over-hide-box", className)}>
      <Card className={cn("relative h-full w-full pt-4", className)}>
        <div className="absolute right-4 flex h-9 items-center justify-center">
          {hasReport && !reportStreaming && (
            <>
              {/* <Tooltip title={t("generatePodcast")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  disabled={isReplay}
                  onClick={handleGeneratePodcast}
                >
                  <Headphones />
                </Button>
              </Tooltip> */}
              <Tooltip title={t("edit")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  disabled={isReplay}
                  onClick={handleEdit}
                >
                  {editing ? <Undo2 /> : <Pencil />}
                </Button>
              </Tooltip>
              <Tooltip title={t("copy")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopy}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </Tooltip>
              <DropdownMenu>
                <Tooltip title="下载报告">
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="text-gray-400"
                      size="icon"
                      variant="ghost"
                    >
                      <Download />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDownloadMarkdown}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>下载为 Markdown</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onShowDownloadDrawer}>
                    <FileType className="mr-2 h-4 w-4" />
                    <span>下载为 Word</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadHTML}>
                    <FileCode className="mr-2 h-4 w-4" />
                    <span>下载为 HTML</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

            </>
          )}
          <Tooltip title={t("close")}>
            <Button
              className="text-gray-400"
              size="sm"
              variant="ghost"
              onClick={() => {
                closeResearch();
              }}
            >
              <X />
            </Button>
          </Tooltip>
        </div>
        <Tabs
          className="flex h-full w-full flex-col "
          value={activeTab}
          onValueChange={(value) => setActiveTab(value)}
        >
          <div className="flex w-full justify-center">
            <TabsList className="">
              <TabsTrigger
                className="px-8"
                value="report"
                disabled={!hasReport}
              >
                {t("report")}
              </TabsTrigger>
              <TabsTrigger className="px-8" value="activities">
                {t("activities")}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            className="h-full min-h-0 flex-grow px-8"
            value="report"
            forceMount
            hidden={activeTab !== "report"}
          >
            <ScrollContainer
              className="px-5pb-20 h-full"
              scrollShadowColor="var(--card)"
              autoScrollToBottom={!hasReport || reportStreaming}
            >
              {reportId && researchId && (
                <ResearchReportBlock
                  className="mt-4"
                  researchId={researchId}
                  messageId={reportId}
                  editing={editing}
                />
              )}
            </ScrollContainer>
          </TabsContent>
          <TabsContent
            className="h-full min-h-0 flex-grow px-4"
            value="activities"
            forceMount
            hidden={activeTab !== "activities"}
          >
            <ScrollContainer
              className="h-full report-box-con"
              scrollShadowColor="var(--card)"
              autoScrollToBottom={!hasReport || reportStreaming}
            >
              {researchId && (
                <ResearchActivitiesBlock
                  className="mt-4 timeline-ul"
                  researchId={researchId}
                />
              )}
            </ScrollContainer>
          </TabsContent>
        </Tabs>

        {/* 跳过当前步骤按钮 */}
        {showSkipButton && (
          <div className="absolute bottom-4 right-4 z-10">
            <Tooltip title="跳过执行">
              <Button
                size="lg"
                onClick={handleSkipExecution}
                className="bg-blue-500 text-white hover:bg-blue-600 shadow-lg rounded-full px-6 py-3 transform transition-all duration-200 hover:scale-105 active:scale-95 text-base font-medium"
              >
                <SkipForward className="h-5 w-5 mr-2" />
                {skipButtonText}
              </Button>
            </Tooltip>
          </div>
        )}
      </Card>
      <HtmlDownDialog
        ref={dialogRef}
        reportId={reportId ?? ""}
        checkpointId={checkpointId}
        fileName={`research-report-${new Date().toISOString().slice(0, 10)}`}
      />
    </div>
  );
}
