// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { useMemo,Suspense } from "react";

import { useStore } from "~/core/store";
import { cn } from "~/lib/utils";

import { MessagesBlockHome } from "./chat/components/message-block-home";
import { ThemeToggle } from "./../components/deer-flow/theme-toggle";
import { SettingsDialog } from "./settings/dialogs/settings-dialog";
import { useTranslations } from "next-intl";
import { ConversationsDialog } from "./settings/dialogs/conversations-dialog";

export default function Main() {
   const t = useTranslations("chat.page");
  const openResearchId = useStore((state) => state.openResearchId);
  const doubleColumnMode = useMemo(
    () => openResearchId !== null,
    [openResearchId],
  );
  return (
    <div
      className={cn(
        "flex h-full w-full justify-center-safe px-4 pt-12 pb-4 home-page-box bg-[url('/images/home-bg.png')]",
        doubleColumnMode && "gap-8",
      )}
    >
            <header className="fixed top-0 left-0 flex h-12 w-full items-center justify-end px-4">
              {/* <Logo /> */}
              <div className="flex items-center">
                {/* <Tooltip title={t("starOnGitHub")}>
                  <Button variant="ghost" size="icon" asChild>
                    <Link
                      href="https://github.com/bytedance/deepResearch"
                      target="_blank"
                    >
                      <GithubOutlined />
                    </Link>
                  </Button>
                </Tooltip> */}
                <Suspense>
                  <ConversationsDialog />
                </Suspense>
                <ThemeToggle />
                <Suspense>
                  <SettingsDialog />
                </Suspense>
              </div>
            </header>
        <div className="content-box">
            <img className="home-logo" src="/images/home-logo.png" alt="" />
        <div className="content-input-box">
            <MessagesBlockHome
        className={cn(
          "shrink-0 transition-all duration-300 ease-out",
          !doubleColumnMode &&
            `w-[768px]`,
          doubleColumnMode && `w-[610px]`,
        )}
      />
        </div>
        </div>

    </div>
  );
}
