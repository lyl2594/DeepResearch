// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章增量④：知识库配置面板（老师完整版）。
// 含 Dify/RAGFlow/ES/AIHUB 四平台入口，AIHUB 专用的 handleAddAihubKB
// 展示 ext_config 里传 username/password 的模式。

import { zodResolver } from "@hookform/resolvers/zod";
import { Database, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  getKnowledgeBaseConfigs,
  saveKnowledgeBaseConfig,
  updateKnowledgeBaseConfig,
} from "~/core/api/rag";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import {
  Tooltip,
} from "~/components/ui/tooltip";
import type { SettingsState } from "~/core/store";
import type { KnowledgeBaseConfig, KnowledgeBasePlatform } from "./rag";

import { AddAihubDialog } from "../dialogs/add-aihub-dialog";
import { AddCommonRAGDialog } from "../dialogs/add-common-dialog";
import { KnowledgeBaseList } from "./rag";
import type { Tab } from "./types";

const knowledgeFormSchema = z.object({
  retriever_similarity: z
    .number({
      required_error: "检索相似度不能为空",
      invalid_type_error: "检索相似度不能为空",
    })
    .min(0, { message: "检索相似度不能小于0" })
    .max(1, { message: "检索相似度不能大于1" }),
  retriever_limit: z
    .number({
      required_error: "检索次数不能为空",
      invalid_type_error: "检索次数不能为空",
    })
    .min(1, { message: "检索次数限制不能小于1" })
    .max(10, { message: "检索次数限制不能大于10" }),
  autoSelectKB: z.boolean(),
});

export const KnowledgeTab: Tab = ({
  settings,
  onChange,
  onValidationChange,
}: {
  settings: SettingsState;
  onChange: (changes: Partial<SettingsState>) => void;
  onValidationChange?: (isValid: boolean) => void;
}) => {
  const t = useTranslations("settings.rag");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseConfig[]>(
    settings.knowledgeBases || [],
  );
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(false);
  const [knowledgeBasesLoaded, setKnowledgeBasesLoaded] = useState(false);
  const [updatingKnowledgeBase, setUpdatingKnowledgeBase] = useState<
    string | null
  >(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [selectedPlatform, setSelectedPlatform] =
    useState<KnowledgeBasePlatform | null>(null);
  const prevKnowledgeBasesRef = useRef<KnowledgeBaseConfig[]>([]);
  const mountedRef = useRef(true);

  const knowledgeSettings = useMemo(
    () => ({
      retriever_similarity: settings.general.retriever_similarity
        ? Number(settings.general.retriever_similarity)
        : 0.4,
      retriever_limit: settings.general.retriever_limit
        ? Number(settings.general.retriever_limit)
        : 3,
      autoSelectKB: settings.general.autoSelectKB || false,
    }),
    [settings],
  );

  const form = useForm<z.infer<typeof knowledgeFormSchema>>({
    resolver: zodResolver(knowledgeFormSchema, undefined, undefined),
    defaultValues: knowledgeSettings,
    mode: "all",
    reValidateMode: "onBlur",
  });

  const currentSettings = form.watch();
  useEffect(() => {
    const hasChanges = Object.keys(currentSettings).some((key) => {
      const currentValue = currentSettings[key as keyof typeof currentSettings];
      const settingsValue =
        settings.general[key as keyof SettingsState["general"]];
      return Number(currentValue) !== Number(settingsValue);
    });

    if (hasChanges) {
      onChange({
        general: {
          ...settings.general,
          ...currentSettings,
        },
      });
    }
  }, [currentSettings, onChange, settings]);

  const prevIsValidRef = useRef<boolean | null>(null);
  useEffect(() => {
    const isValid = form.formState.isValid;

    if (prevIsValidRef.current !== isValid) {
      prevIsValidRef.current = isValid;
      onValidationChange?.(isValid);
    }
  }, [form.formState.isValid, onValidationChange]);

  const loadKnowledgeBasesFromDB = useCallback(
    async (force = false) => {
      if (!force && knowledgeBasesLoaded) {
        return;
      }
      console.log("loadKnowledgeBasesFromDB");

      if (!force && !mountedRef.current) return;

      setLoadingKnowledgeBases(true);
      try {
        const configs = await getKnowledgeBaseConfigs();

        const formattedConfigs: KnowledgeBaseConfig[] = configs.map(
          (config: any) => ({
            id: String(config.id),
            name: config.name,
            platform: config.platform,
            api_url: config.api_url,
            ext_config: config.ext_config || {},
            retrieval_size: config.retrieval_size,
            similarity: config.similarity,
            enabled: config.is_selected || false,
          }),
        );
        setKnowledgeBases(formattedConfigs);
        setKnowledgeBasesLoaded(true);
        onChange({ ...settings, knowledgeBases: formattedConfigs });
      } catch (error) {
        console.error("Failed to load knowledge bases from database:", error);
        if (mountedRef.current) {
          setKnowledgeBasesLoaded(true);
        }
      } finally {
        setLoadingKnowledgeBases(false);
      }
    },
    [knowledgeBasesLoaded, settings, onChange],
  );

  useEffect(() => {
    loadKnowledgeBasesFromDB();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      JSON.stringify(prevKnowledgeBasesRef.current) !==
      JSON.stringify(settings.knowledgeBases)
    ) {
      setKnowledgeBases(settings.knowledgeBases || []);
      prevKnowledgeBasesRef.current = settings.knowledgeBases || [];
    }
  }, [settings.knowledgeBases]);

  const handleAddCommonKnowledgeBase = useCallback(
    async (config: Omit<KnowledgeBaseConfig, "id">) => {
      try {
        const result = await saveKnowledgeBaseConfig({
          user_id: settings.general.userID ?? "default_user",
          name: config.name,
          platform: config.platform,
          api_url: config.api_url,
          ext_config: config.ext_config,
          retrieval_size: config.retrieval_size,
          similarity: config.similarity,
          is_enabled: config.enabled,
        });

        const newConfig: KnowledgeBaseConfig = {
          ...config,
          id: String(result.id),
        };

        const newKnowledgeBases = [...knowledgeBases, newConfig];
        setKnowledgeBases(newKnowledgeBases);
        onChange({ ...settings, knowledgeBases: newKnowledgeBases });
        setAddDialogOpen(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "保存知识库失败";
        throw new Error(message);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  // AIHUB 专用保存：与 handleAddCommonKnowledgeBase 结构一致，
  // 区别在于 config.ext_config 已由 AddAihubDialog 填好 { username, password }
  const handleAddAihubKB = useCallback(
    async (config: Omit<KnowledgeBaseConfig, "id">) => {
      try {
        const result = await saveKnowledgeBaseConfig({
          user_id: settings.general.userID ?? "default_user",
          name: config.name,
          platform: config.platform,
          api_url: config.api_url,
          ext_config: config.ext_config,
          retrieval_size: config.retrieval_size,
          similarity: config.similarity,
          is_enabled: config.enabled,
        });

        const newConfig: KnowledgeBaseConfig = {
          ...config,
          id: String(result.id),
        };

        const newKnowledgeBases = [...knowledgeBases, newConfig];
        setKnowledgeBases(newKnowledgeBases);
        onChange({ ...settings, knowledgeBases: newKnowledgeBases });
        setAddDialogOpen(false);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "保存知识库失败，请重试";
        throw new Error(errorMessage);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  const handleDeleteKnowledgeBase = useCallback(
    (id: string) => {
      const newKnowledgeBases = knowledgeBases.filter((kb) => kb.id !== id);
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });
    },
    [knowledgeBases, onChange, settings],
  );

  const handleToggleKnowledgeBase = useCallback(
    async (id: string, enabled: boolean) => {
      const originalKnowledgeBases = knowledgeBases;
      const newKnowledgeBases = knowledgeBases.map((kb) =>
        kb.id === id ? { ...kb, enabled } : kb,
      );
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });

      setUpdatingKnowledgeBase(id);

      try {
        await updateKnowledgeBaseConfig(id, { id: id, is_enabled: enabled });
      } catch (error) {
        console.error("Failed to update knowledge base status:", error);

        if (mountedRef.current) {
          setKnowledgeBases(originalKnowledgeBases);
          onChange({ ...settings, knowledgeBases: originalKnowledgeBases });
        }

        alert("更新知识库状态失败，请重试");
      } finally {
        setUpdatingKnowledgeBase(null);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  const handleRefreshKnowledgeBase = useCallback((id: string) => {
    console.log("Refreshing knowledge base:", id);
  }, []);

  const handleEditKnowledgeBase = useCallback(
    (config: KnowledgeBaseConfig) => {
      const newKnowledgeBases = knowledgeBases.map((kb) =>
        kb.id === config.id ? config : kb,
      );
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });
    },
    [knowledgeBases, onChange, settings],
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-medium">{t("title")}</h1>
      </header>

      <main className="flex flex-col gap-8">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">{t("knowledgeBases")}</h2>
            </div>
            <div className="flex items-center gap-2">
              {loadingKnowledgeBases && (
                <span className="text-muted-foreground text-sm">加载中...</span>
              )}
              {updatingKnowledgeBase && (
                <span className="text-muted-foreground text-sm">更新中...</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={loadingKnowledgeBases || !!updatingKnowledgeBase}
                  >
                    {t("addKnowledgeBase")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("dify");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/dify-color.svg"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    Dify
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("ragflow");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/ragflow-logo.svg"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    RAGFlow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("aihub");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/aihub-logo.png"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    AIHUB
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("es");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/es-logo.ico"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    Elasticsearch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadKnowledgeBasesFromDB(true)}
                disabled={loadingKnowledgeBases || !!updatingKnowledgeBase}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                刷新
              </Button>

              <AddCommonRAGDialog
                open={
                  addDialogOpen &&
                  (selectedPlatform === "dify" ||
                    selectedPlatform === "ragflow" ||
                    selectedPlatform === "es")
                }
                onOpenChange={(open) => {
                  setAddDialogOpen(open);
                  if (!open) {
                    setSelectedPlatform(null);
                  }
                }}
                onAdd={handleAddCommonKnowledgeBase}
                editConfig={
                  (selectedPlatform === "dify" ||
                    selectedPlatform === "ragflow" ||
                    selectedPlatform === "es") &&
                  addDialog
                    ? null
                    : {
                        id: "",
                        user_id: "",
                        name: "",
                        platform: selectedPlatform as "dify" | "ragflow" | "es",
                        api_url: "",
                        ext_config: {},
                        retrieval_size: 10,
                        similarity: 0.6,
                        enabled: false,
                      }
                }
                initialPlatform={selectedPlatform || "dify"}
              />
              <AddAihubDialog
                open={addDialogOpen && selectedPlatform === "aihub"}
                onOpenChange={(open) => {
                  setAddDialogOpen(open);
                  if (!open) {
                    setSelectedPlatform(null);
                  }
                }}
                onAdd={handleAddAihubKB}
                editConfig={
                  selectedPlatform === "aihub" && addDialog
                    ? null
                    : {
                        id: "",
                        user_id: "",
                        name: "",
                        platform: selectedPlatform as "aihub",
                        api_url: "",
                        ext_config: {},
                        retrieval_size: 10,
                        similarity: 0.6,
                        enabled: false,
                      }
                }
              />
            </div>
          </div>

          <KnowledgeBaseList
            knowledgeBases={knowledgeBases}
            onDelete={handleDeleteKnowledgeBase}
            onToggle={handleToggleKnowledgeBase}
            onRefresh={handleRefreshKnowledgeBase}
            onEdit={handleEditKnowledgeBase}
          />
        </section>

      </main>
    </div>
  );
};
KnowledgeTab.displayName = "知识库配置";
KnowledgeTab.icon = Database;
