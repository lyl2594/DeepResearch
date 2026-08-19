// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { create } from "zustand";

import type { MCPServerMetadata, SimpleMCPServerMetadata } from "../mcp";
import type { KnowledgeBaseConfig } from "~/typings/knowledge-base";

const SETTINGS_KEY = "deerflow.settings";

const DEFAULT_SETTINGS: SettingsState = {
  general: {
    autoAcceptedPlan: true,  // ch08 默认跳过 HITL 计划确认；ch09+ 讲 HITL 时可改回 false 或用 UI 开关
    enableDeepThinking: false,
    enableWebSearch: false,
    enableBackgroundInvestigation: false,
    maxPlanIterations: 1,
    maxStepNum: 3,
    maxSearchResults: 3,
    reportStyle: "academic",
    retriever_limit: 3,
    retriever_similarity: 0.4,
    max_step_retry: 1,
    min_step_score: 0.8,
    enableRAG: true,
    autoSelectKB: true,
  },
  mcp: {
    servers: [],
  },
  knowledgeBases: [],
};

export type SettingsState = {
  general: {
    autoAcceptedPlan: boolean;
    enableDeepThinking: boolean;
    enableWebSearch: boolean;
    enableBackgroundInvestigation: boolean;
    maxPlanIterations: number;
    maxStepNum: number;
    maxSearchResults: number;
    reportStyle: "academic" | "popular_science" | "news" | "social_media";
    retriever_similarity?: number;
    retriever_limit?: number;
    max_step_retry?: number;
    min_step_score?: number;
    enableRAG?: boolean;
    autoSelectKB?: boolean;
    userID?: string;
  };
  mcp: {
    servers: MCPServerMetadata[];
  };
  knowledgeBases: KnowledgeBaseConfig[];
};

export const useSettingsStore = create<SettingsState>(() => ({
  ...DEFAULT_SETTINGS,
}));

export const useSettings = (key: keyof SettingsState) => {
  return useSettingsStore((state) => state[key]);
};

export const changeSettings = (settings: SettingsState) => {
  useSettingsStore.setState(settings);
};

export const loadSettings = () => {
  if (typeof window === "undefined") {
    return;
  }
  const json = localStorage.getItem(SETTINGS_KEY);
  if (json) {
    const settings = JSON.parse(json);
    for (const key in DEFAULT_SETTINGS.general) {
      if (!(key in settings.general)) {
        settings.general[key as keyof SettingsState["general"]] =
          DEFAULT_SETTINGS.general[key as keyof SettingsState["general"]];
      }
    }

    try {
      useSettingsStore.setState(settings);
    } catch (error) {
      console.error(error);
    }
  }
};

export const saveSettings = () => {
  const latestSettings = useSettingsStore.getState();
  const json = JSON.stringify(latestSettings);
  localStorage.setItem(SETTINGS_KEY, json);
};

export const getChatStreamSettings = () => {
  let mcpSettings:
    | {
      servers: Record<
        string,
        MCPServerMetadata & {
          enabled_tools: string[];
          add_to_agents: string[];
        }
      >;
    }
    | undefined = undefined;
  const { mcp, general, knowledgeBases } = useSettingsStore.getState();
  const mcpServers = mcp.servers.filter((server) => server.enabled);
  if (mcpServers.length > 0) {
    mcpSettings = {
      servers: mcpServers.reduce((acc, cur) => {
        const { transport, env, headers } = cur;
        let server: SimpleMCPServerMetadata;
        if (transport === "stdio") {
          server = {
            name: cur.name,
            transport,
            env,
            command: cur.command,
            args: cur.args,
          };
        } else {
          server = {
            name: cur.name,
            transport,
            headers,
            url: cur.url,
          };
        }
        return {
          ...acc,
          [cur.name]: {
            ...server,
            enabled_tools: cur.tools.map((tool) => tool.name),
            add_to_agents: ["researcher"],
          },
        };
      }, {}),
    };
  }

  // RAG 平台配置：把用户启用的知识库塞进 chat 请求 rag_configs。
  // 后端 rag/builder.py:build_retriever_by_configs 按 platform 分派 provider
  // （目前 aihub 走真连接，其它走 memory 分支）。字段结构对齐后端解析：
  //   platform / rag_platform_id / api_url / retrieval_size / similarity / ext_config
  const enabledKBs = general.enableRAG
    ? (knowledgeBases ?? []).filter((kb) => kb.enabled)
    : [];
  const rag_configs = enabledKBs.map((kb) => ({
    rag_platform_id: kb.id ?? "",
    platform: kb.platform,
    api_url: kb.api_url,
    retrieval_size: kb.retrieval_size,
    similarity: kb.similarity,
    ext_config: kb.ext_config ?? {},
  }));

  return {
    ...general,
    mcpSettings,
    rag_configs,
  };
};

export function setReportStyle(
  value: "academic" | "popular_science" | "news" | "social_media",
) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      reportStyle: value,
    },
  }));
  saveSettings();
}

export function setEnableDeepThinking(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableDeepThinking: value,
    },
  }));
  saveSettings();
}

export function setEnableBackgroundInvestigation(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableBackgroundInvestigation: value,
    },
  }));
  saveSettings();
}
// 设置是否开启rag
export function setEnableRAG(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableRAG: value,
    },
  }));
  saveSettings();
}
export function setEnableWebSearch(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableWebSearch: value,
    },
  }));
  saveSettings();
}
loadSettings();
