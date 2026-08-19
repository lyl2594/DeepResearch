// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState, useCallback } from "react";

import { env } from "~/env";

import type { DeerFlowConfig } from "../config";
import type { Conversation } from "../messages";
import { useReplay } from "../replay";

import { fetchReplayTitle } from "./chat";
import { queryConversations } from "./conversations";
import { resolveServiceURL } from "./resolve-service-url";

export function useReplayMetadata() {
  const { isReplay } = useReplay();
  const [title, setTitle] = useState<string | null>('深思');
  const isLoading = useRef(false);
  const [error, setError] = useState<boolean>(false);
  useEffect(() => {
    if (!isReplay) {
      return;
    }
    if (title || isLoading.current) {
      return;
    }
    isLoading.current = true;
    fetchReplayTitle()
      .then((title) => {
        setError(false);
        setTitle(title ?? null);
        if (title) {
          document.title = '深思';
        }
      })
      .catch(() => {
        setError(true);
        setTitle("Error: the replay is not available.");
        document.title = "深思";
      })
      .finally(() => {
        isLoading.current = false;
      });
  }, [isLoading, isReplay, title]);
  return { title, isLoading, hasError: error };
}

export function useConfig(): {
  config: DeerFlowConfig | null;
  loading: boolean;
} {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<DeerFlowConfig | null>(null);

  useEffect(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY) {
      setLoading(false);
      return;
    }
    fetch(resolveServiceURL("./config"))
      .then((res) => res.json())
      .then((config) => {
        setConfig(config);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch config", err);
        setConfig(null);
        setLoading(false);
      });
  }, []);

  return { config, loading };
}

export function useConversations(): {
  results: Conversation[];
  loading: boolean;
  refresh: () => void; // 刷新函数
} {
  const [results, setResults] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const hasInitialized = useRef(false);
  const maxRetries = useRef(3);

  const fetchConversations = useCallback(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY) {
      setLoading(false);
      return;
    }
    if (hasInitialized.current && maxRetries.current <= 0) return;

    queryConversations()
      .then((data) => {
        setResults(data || []);
        setLoading(false);
        hasInitialized.current = true;
        maxRetries.current = 0;
      })
      .catch((error) => {
        console.error("Failed to fetch replays", error);
        setLoading(false);
        if (maxRetries.current > 0) {
          maxRetries.current -= 1;
          console.warn(`Retrying... (${3 - maxRetries.current} attempts left)`);
        }
      });
  }, []);

  useEffect(() => {
    fetchConversations();
    return () => {
      hasInitialized.current = false;
      maxRetries.current = 3;
    };
  }, [fetchConversations]);

  const refresh = useCallback(() => {
    hasInitialized.current = false;
    maxRetries.current = 3;
    setLoading(true);
    fetchConversations();
  }, [fetchConversations]);

  return { results, loading, refresh };
}