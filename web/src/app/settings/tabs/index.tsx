// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { Settings, type LucideIcon } from "lucide-react";

import { AboutTab } from "./about-tab";
import { ChanglogTab } from "./changlog-tab";
import { GeneralTab } from "./general-tab";
import { MCPTab } from "./mcp-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { ResearchStepsTab } from "./research-steps-tab";

export const SETTINGS_TABS = [GeneralTab, KnowledgeTab, ResearchStepsTab, MCPTab, ChanglogTab].map((tab) => {
  const name = tab.displayName ?? tab.name;
  return {
    ...tab,
    id: name.replace(/Tab$/, "").toLocaleLowerCase(),
    label: name.replace(/Tab$/, ""),
    icon: (tab.icon ?? <Settings />) as LucideIcon,
    component: tab,
  };
});
