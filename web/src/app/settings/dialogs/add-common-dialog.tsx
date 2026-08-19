// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { message } from "antd";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { testKnowledgeBaseConnection } from "~/core/api/rag";
import {
  type KnowledgeBaseConfig,
  type KnowledgeBasePlatform,
} from "~/typings/knowledge-base";

interface PlatformConfig {
  logo: string;
  defaultApiUrl: string;
  placeholderApiUrl: string;
  apiKeyPlaceholder: string;
}

const PLATFORM_CONFIG: Record<KnowledgeBasePlatform, PlatformConfig> = {
  dify: {
    logo: "/images/dify-color.svg",
    defaultApiUrl: "https://api.dify.com",
    placeholderApiUrl: "https://api.dify.com",
    apiKeyPlaceholder: "Dify API Key",
  },
  ragflow: {
    logo: "/images/ragflow-logo.svg",
    defaultApiUrl: "https://ragflow-api.example.com",
    placeholderApiUrl: "https://ragflow-api.example.com",
    apiKeyPlaceholder: "RAGFlow API Key",
  },
  aihub: {
    logo: "/images/aihub-logo.svg",
    defaultApiUrl: "https://aihub-api.example.com",
    placeholderApiUrl: "https://aihub-api.example.com",
    apiKeyPlaceholder: "AIHUB API Key",
  },
  es: {
    logo: "/images/es-logo.ico",
    defaultApiUrl: "https://es-api.example.com",
    placeholderApiUrl: "https://es-api.example.com",
    apiKeyPlaceholder: "Elasticsearch API Key",
  },
};

interface AddKnowledgeBaseDialogProps {
  onAdd: (config: Omit<KnowledgeBaseConfig, "id" | "status">) => void;
  onEdit?: (config: KnowledgeBaseConfig) => void;
  editConfig?: KnowledgeBaseConfig | null;
  initialPlatform: KnowledgeBasePlatform;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function AddCommonRAGDialog({
  onAdd,
  onEdit,
  editConfig,
  initialPlatform,
  open: controlledOpen,
  onOpenChange,
  onClose,
  children,
}: AddKnowledgeBaseDialogProps) {
  const t = useTranslations("settings.rag");
  const isEdit = !!editConfig;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const [platform, setPlatform] = useState(initialPlatform);
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [retrievalSize, setRetrievalSize] = useState<number>(10);
  const [similarity, setSimilarity] = useState<number>(0.6);
  const [messageApi, contextHolder] = message.useMessage();
  const [testing, setTesting] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    apiUrl?: string;
    apiKey?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPlatform(editConfig?.platform || initialPlatform);
    setName("");
    setApiUrl("");
    setApiKey("");
    setRetrievalSize(10);
    setSimilarity(0.6);
    setErrors({});
    setSubmitError(null);
  }, [editConfig, initialPlatform]);

  const initializeForm = useCallback(
    (config: KnowledgeBaseConfig | null) => {
      if (config) {
        setPlatform(config.platform);
        setName(config.name);
        setApiUrl(config.api_url);
        setApiKey(config.ext_config["api_key"] || "");
        setRetrievalSize(config.retrieval_size);
        setSimilarity(config.similarity);
        setErrors({});
      } else {
        resetForm();
      }
    },
    [resetForm],
  );

  const closeDialog = useCallback(() => {
    if (controlledOpen === undefined) {
      setInternalOpen(false);
    }
    onOpenChange?.(false);
    resetForm();
  }, [controlledOpen, onOpenChange, resetForm]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetForm();
        onClose?.();
      }
      if (controlledOpen === undefined) {
        setInternalOpen(newOpen);
      }
      onOpenChange?.(newOpen);
    },
    [resetForm, onOpenChange, controlledOpen, onClose],
  );

  const handleTestConnection = async () => {
    try {
      setTesting(true);

      const res = await testKnowledgeBaseConnection({
        platform,
        api_url: apiUrl,
        ext_config: { api_key: apiKey },
      });

      if (res?.success === true) {
        messageApi.open({
          type: "success",
          content: t("testSuccess", { count: res.resource_count ?? 0 }),
        });
      } else {
        messageApi.open({
          type: "error",
          content: res?.message
            ? t("testFailedWithReason", { reason: res.message })
            : t("testFailed"),
        });
      }
    } catch (e: any) {
      messageApi.open({
        type: "error",
        content: e?.message
          ? t("testFailedWithReason", { reason: e.message })
          : t("testFailed"),
      });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    if (editConfig) {
      initializeForm(editConfig);
      if (controlledOpen === undefined) {
        setInternalOpen(true);
      }
    } else if (initialPlatform) {
      setPlatform(initialPlatform);
    }
  }, [editConfig, controlledOpen, initializeForm, initialPlatform]);

  const validateForm = useCallback(() => {
    const newErrors: {
      name?: string;
      apiUrl?: string;
      apiKey?: string;
    } = {};

    if (!name.trim()) {
      newErrors.name = t("nameRequired");
    }

    if (!apiUrl.trim()) {
      newErrors.apiUrl = t("apiUrlRequired");
    } else {
      try {
        new URL(apiUrl);
      } catch {
        newErrors.apiUrl = t("apiUrlInvalid");
      }
    }

    if (!apiKey.trim()) {
      newErrors.apiKey = t("apiKeyRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, apiUrl, apiKey, t]);

  const handleAdd = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSubmitError(null);

    try {
      const configData = {
        user_id: "default_user",
        platform: platform,
        name: name.trim(),
        api_url: apiUrl.trim(),
        ext_config: {
          api_key: apiKey.trim(),
        },
        retrieval_size: retrievalSize,
        similarity: similarity,
        enabled: true,
      };

      if (isEdit && editConfig && onEdit) {
        await onEdit({
          ...editConfig,
          ...configData,
        });
      } else {
        await onAdd(configData);
      }
      messageApi.open({
        type: "success",
        content: "添加知识库成功",
      });
      closeDialog();
    } catch (error) {
      console.error("Failed to save knowledge base:", error);
      messageApi.open({
        type: "error",
        content: "保存失败",
      });
      setSubmitError("保存知识库失败");
    } finally {
      setLoading(false);
    }
  }, [
    platform,
    name,
    apiUrl,
    apiKey,
    retrievalSize,
    onAdd,
    onEdit,
    editConfig,
    isEdit,
    validateForm,
    resetForm,
    closeDialog,
    t,
  ]);

  return (
    <>
      {contextHolder}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center">
              <img
                src={
                  PLATFORM_CONFIG[platform]?.logo || PLATFORM_CONFIG.dify.logo
                }
                alt=""
                className="mr-2 h-5 w-5"
              />
              <DialogTitle>
                {isEdit ? t("editKnowledgeBase") : t("addKnowledgeBase")}
              </DialogTitle>
            </div>
            <DialogDescription>
              {isEdit
                ? t("editKnowledgeBaseDescription")
                : t("addKnowledgeBaseDescription")}
            </DialogDescription>
          </DialogHeader>

          {submitError && (
            <div className="text-destructive bg-destructive/10 rounded-md p-3 text-sm">
              {submitError}
            </div>
          )}

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && (
                <p className="text-destructive text-sm">{errors.name}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="api_url">{t("apiUrl")}</Label>
              <Input
                id="api_url"
                placeholder={
                  PLATFORM_CONFIG[platform]?.placeholderApiUrl ||
                  PLATFORM_CONFIG.dify.placeholderApiUrl
                }
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              {errors.apiUrl && (
                <p className="text-destructive text-sm">{errors.apiUrl}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="api_key">{t("apiKey")}</Label>
              <PasswordInput
                id="api_key"
                placeholder={
                  PLATFORM_CONFIG[platform]?.apiKeyPlaceholder ||
                  PLATFORM_CONFIG.dify.apiKeyPlaceholder
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {errors.apiKey && (
                <p className="text-destructive text-sm">{errors.apiKey}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="retrieval_size">{t("retrievalSize")}</Label>
              <Input
                id="retrieval_size"
                type="number"
                min={1}
                max={20}
                value={retrievalSize}
                onChange={(e) =>
                  setRetrievalSize(parseInt(e.target.value) || 10)
                }
              />
              <p className="text-muted-foreground text-sm">
                {t("retrievalSizeDescription")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="similarity">{t("similarity")}</Label>
              <Input
                id="similarity"
                type="number"
                min={0.1}
                max={1.0}
                step={0.1}
                value={similarity}
                onChange={(e) =>
                  setSimilarity(parseFloat(e.target.value) || 0.6)
                }
              />
              <p className="text-muted-foreground text-sm">
                {t("similarityDescription")}
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center">
            {/* 左侧测试按钮 */}
            <Button
              variant="secondary"
              type="button"
              disabled={!apiUrl.trim() || !apiKey.trim() || testing}
              onClick={handleTestConnection}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              测试连接
              {/* {t("test")} */}
            </Button>
            {/* 占位，把右侧按钮推到最右 */}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={closeDialog}>
                {t("cancel")}
              </Button>
              <Button
                className="w-24"
                type="submit"
                disabled={
                  loading || !name.trim() || !apiUrl.trim() || !apiKey.trim()
                }
                onClick={handleAdd}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? t("save") : t("add")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
