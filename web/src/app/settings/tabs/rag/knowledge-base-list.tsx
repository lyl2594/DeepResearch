// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { motion } from "framer-motion";
import { Database, Edit2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  deleteKnowledgeBaseConfig,
  updateKnowledgeBaseConfig,
} from "~/core/api/rag";
import { cn } from "~/lib/utils";

import { type KnowledgeBaseConfig, type KnowledgeBasePlatform } from ".";
import { AddAihubDialog } from "../../dialogs/add-aihub-dialog";
import { AddCommonRAGDialog } from "../../dialogs/add-common-dialog";

interface KnowledgeBaseListProps {
  knowledgeBases: KnowledgeBaseConfig[];
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRefresh: (id: string) => void;
  onEdit?: (config: KnowledgeBaseConfig) => void;
}

const platformIcons: Record<KnowledgeBasePlatform, string> = {
  ragflow: "/images/ragflow-logo.svg",
  dify: "/images/dify-color.svg",
  aihub: "/images/aihub-logo.png",
  es: "/images/es-logo.ico",
};

const platformLabels: Record<KnowledgeBasePlatform, string> = {
  ragflow: "RAGFlow",
  dify: "Dify",
  aihub: "AIHUB",
  es: "Elasticsearch",
};

export function KnowledgeBaseList({
  knowledgeBases,
  onDelete,
  onToggle,
  onRefresh,
  onEdit,
}: KnowledgeBaseListProps) {
  const t = useTranslations("settings.rag");
  const [newlyAdded, setNewlyAdded] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] =
    useState<KnowledgeBaseConfig | null>(null);
  const [commonDialogOpen, setCommonDialogOpen] = useState(false);
  const [aihubDialogOpen, setAihubDialogOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] =
    useState<KnowledgeBasePlatform | null>(null);

  const handleEdit = useCallback(
    async (config: KnowledgeBaseConfig) => {
      if (config.id === undefined) {
        onEdit?.(config);
        return;
      }
      setLoading("edit");
      setError(null);
      try {
        const result = await updateKnowledgeBaseConfig(config.id, {
          name: config.name,
          platform: config.platform,
          api_url: config.api_url,
          ext_config: config.ext_config,
          retrieval_size: config.retrieval_size,
        });
        const updatedConfig: KnowledgeBaseConfig = {
          ...config,
          id: result.id,
        };
        onEdit?.(updatedConfig);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to update knowledge base",
        );
      } finally {
        setLoading(null);
      }
    },
    [onEdit],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setLoading("delete");
      setError(null);
      try {
        if (id !== undefined) {
          await deleteKnowledgeBaseConfig(id);
        }
        onDelete(id);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to delete knowledge base",
        );
      } finally {
        setLoading(null);
      }
    },
    [onDelete],
  );

  const handleRefresh = useCallback(
    (id: string) => {
      console.log("Refreshing knowledge base:", id);
      onRefresh(id);
    },
    [onRefresh],
  );

  const animationProps = {
    initial: { backgroundColor: "gray" },
    animate: { backgroundColor: "transparent" },
    transition: { duration: 1 },
    style: {
      transition: "background-color 1s ease-out",
    },
  };

  if (knowledgeBases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Database className="text-muted-foreground mb-4 h-12 w-12" />
        <p className="text-muted-foreground mb-4">{t("noKnowledgeBases")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(loading || error) && (
        <div className="bg-muted flex items-center justify-between rounded-lg p-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>
                {loading === "add" && "添加知识库中..."}
                {loading === "edit" && "更新知识库中..."}
                {loading === "delete" && "删除知识库中..."}
              </span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <span>错误: {error}</span>
              <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                关闭
              </Button>
            </div>
          )}
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {knowledgeBases.map((kb) => (
          <motion.li
            className={cn(
              "!bg-card group relative overflow-hidden rounded-lg border pb-2 shadow duration-300",
              !kb.enabled && "opacity-70",
            )}
            key={kb.id}
            {...(kb.id === newlyAdded && animationProps)}
          >
            <div className="absolute top-3 right-3 z-10">
              <Switch
                checked={kb.enabled}
                onCheckedChange={(checked) => {
                  onToggle(kb.id, checked);
                }}
              />
            </div>

            <div className="absolute top-1 right-12 z-10 flex gap-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <Tooltip title={t("edit")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={loading === "edit"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingConfig(kb);
                    if (kb.platform === "dify") {
                      setCommonDialogOpen(true);
                      setSelectedPlatform("dify");
                    } else if (kb.platform === "aihub") {
                      setAihubDialogOpen(true);
                      setSelectedPlatform("aihub");
                    } else if (kb.platform === "ragflow") {
                      setCommonDialogOpen(true);
                      setSelectedPlatform("ragflow");
                    } else if (kb.platform === "es") {
                      setCommonDialogOpen(true);
                      setSelectedPlatform("es");
                    }
                  }}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip title={t("refresh")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRefresh(kb.id);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </Tooltip>
              <Tooltip title={t("delete")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={loading === "delete"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(kb.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>

            <div
              className={cn(
                "flex flex-col items-start px-4 py-3",
                !kb.enabled && "text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "mb-2 flex items-center gap-2",
                  !kb.enabled && "opacity-70",
                )}
              >
                <span className="text-lg">
                  <img
                    src={platformIcons[kb.platform]}
                    alt=""
                    className="mr-2 h-4 w-4"
                  />
                </span>
                <span className="font-medium">{kb.name}</span>
                <span className="bg-primary text-primary-foreground h-fit rounded px-1.5 py-0.5 text-xs">
                  {platformLabels[kb.platform]}
                </span>
              </div>

              <div className="text-muted-foreground flex flex-col gap-1 text-sm">
                <span className="max-w-[300px] truncate">
                  {t("apiUrl")}: {kb.api_url}
                </span>
                <span>
                  {t("retrievalSize")}: {kb.retrieval_size}
                </span>
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
      <AddCommonRAGDialog
        open={commonDialogOpen}
        onOpenChange={setCommonDialogOpen}
        editConfig={editingConfig}
        onAdd={() => {}}
        onEdit={handleEdit}
        onClose={() => {
          setEditingConfig(null);
        }}
        initialPlatform={selectedPlatform || "dify"}
      />
      <AddAihubDialog
        open={aihubDialogOpen}
        onOpenChange={setAihubDialogOpen}
        editConfig={editingConfig}
        onAdd={() => {}}
        onEdit={handleEdit}
        onClose={() => {
          setEditingConfig(null);
        }}
      />
    </div>
  );
}
