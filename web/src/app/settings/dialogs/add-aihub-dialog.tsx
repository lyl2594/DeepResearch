// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章增量④：AIHUB 知识库添加对话框（老师完整版）。
// 核心教学点：ext_config 里传 username/password 给后端。

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
import type {
  KnowledgeBaseConfig,
  KnowledgeBasePlatform,
} from "~/typings/knowledge-base";

interface AddKnowledgeBaseDialogProps {
  onAdd: (config: Omit<KnowledgeBaseConfig, "id" | "status">) => void;
  onEdit?: (config: KnowledgeBaseConfig) => void;
  editConfig?: KnowledgeBaseConfig | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function AddAihubDialog({
  onAdd,
  onEdit,
  editConfig,
  open: controlledOpen,
  onOpenChange,
  onClose,
  children,
}: AddKnowledgeBaseDialogProps) {
  const t = useTranslations("settings.rag");
  const isEdit = !!editConfig;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const [platform, setPlatform] = useState<KnowledgeBasePlatform>("aihub");
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [retrievalSize, setRetrievalSize] = useState<number>(10);
  const [similarity, setSimilarity] = useState<number>(0.6);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [errors, setErrors] = useState<{
    name?: string;
    apiUrl?: string;
    username?: string;
    password?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPlatform("aihub");
    setName("");
    setApiUrl("");
    setUsername("");
    setPassword("");
    setRetrievalSize(10);
    setSimilarity(0.6);
    setErrors({});
    setSubmitError(null);
  }, []);

  const initializeForm = useCallback(
    (config: KnowledgeBaseConfig | null) => {
      if (config) {
        setPlatform("aihub");
        setName(config.name);
        setApiUrl(config.api_url);
        setUsername(config.ext_config["username"] || "");
        setPassword(config.ext_config["password"] || "");
        setRetrievalSize(config.retrieval_size);
        setSimilarity(config.similarity);
        setErrors({});
      } else {
        resetForm();
      }
    },
    [resetForm],
  );

  const handleTestConnection = async () => {
    try {
      setTesting(true);

      const res = await testKnowledgeBaseConnection({
        platform: "aihub",
        api_url: apiUrl,
        ext_config: { username, password },
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
        content: t("testFailed"),
      });
    } finally {
      setTesting(false);
    }
  };

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

  useEffect(() => {
    if (editConfig) {
      initializeForm(editConfig);
      if (controlledOpen === undefined) {
        setInternalOpen(true);
      }
    }
  }, [editConfig, controlledOpen, initializeForm]);

  const validateForm = useCallback(() => {
    const newErrors: {
      name?: string;
      apiUrl?: string;
      username?: string;
      password?: string;
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

    if (!username.trim()) {
      newErrors.username = t("usernameRequired");
    }

    if (!password.trim()) {
      newErrors.password = t("passwordRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, apiUrl, username, password, t]);

  const handleAdd = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSubmitError(null);

    try {
      // AIHUB 的核心：ext_config 里放 username/password
      const configData = {
        user_id: "default_user",
        platform: platform,
        name: name.trim(),
        api_url: apiUrl.trim(),
        ext_config: {
          username: username.trim(),
          password: password.trim(),
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
    username,
    password,
    retrievalSize,
    similarity,
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
                src="/images/aihub-logo.png"
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
                placeholder="https://api.aihub.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              {errors.apiUrl && (
                <p className="text-destructive text-sm">{errors.apiUrl}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                placeholder={t("usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {errors.username && (
                <p className="text-destructive text-sm">{errors.username}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">{t("password")}</Label>

              <PasswordInput
                id="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {errors.password && (
                <p className="text-destructive text-sm">{errors.password}</p>
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
            <Button
              variant="secondary"
              type="button"
              disabled={
                !apiUrl.trim() ||
                !username.trim() ||
                !password.trim() ||
                testing
              }
              onClick={handleTestConnection}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              测试连接
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={closeDialog}>
                {t("cancel")}
              </Button>

              <Button
                className="w-24"
                type="submit"
                disabled={
                  loading ||
                  !name.trim() ||
                  !apiUrl.trim() ||
                  !username.trim() ||
                  !password.trim()
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