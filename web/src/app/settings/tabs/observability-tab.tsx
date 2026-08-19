// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章新增：可观测性设置面板。
// 学生学到 LangSmith trace 配置的前端呈现方式。
// 注意：真正的 tracing 是后端 langchain 自动读 LANGCHAIN_* 环境变量，
// 这个页面只是"看/记住 key 的开关状态"，不做实际写文件。

import { Activity } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { Switch } from "~/components/ui/switch";
import type { SettingsState } from "~/core/store";
import type { Tab } from "./types";

// 表单验证
const observabilityFormSchema = z.object({
    langsmith_enabled: z.boolean(),
    langsmith_api_key: z.string().optional(),
    langsmith_project: z.string().optional(),
});

export const ObservabilityTab: Tab = ({
    settings,
    onChange,
    onValidationChange,
}: {
    settings: SettingsState;
    onChange: (changes: Partial<SettingsState>) => void;
    onValidationChange?: (isValid: boolean) => void;
}) => {
    const observabilitySettings = useMemo(() => ({
        langsmith_enabled: Boolean(settings.general?.langsmith_enabled ?? false),
        langsmith_api_key: String(settings.general?.langsmith_api_key ?? ""),
        langsmith_project: String(settings.general?.langsmith_project ?? "deepResearch"),
    }), [settings]);

    const form = useForm<z.infer<typeof observabilityFormSchema>>({
        resolver: zodResolver(observabilityFormSchema, undefined, undefined),
        defaultValues: observabilitySettings,
        mode: "all",
        reValidateMode: "onBlur",
    });

    // 监听表单值变化并写回全局 settings
    const currentSettings = form.watch();
    useEffect(() => {
        const hasChanges = Object.keys(currentSettings).some(key => {
            const currentValue = currentSettings[key as keyof typeof currentSettings];
            const settingsValue = (settings.general as any)?.[key];
            return currentValue !== settingsValue;
        });

        if (hasChanges) {
            onChange({
                general: {
                    ...settings.general,
                    ...currentSettings,
                } as any,
            });
        }
    }, [currentSettings, onChange, settings]);

    // 监听表单验证状态
    const prevIsValidRef = useRef<boolean | null>(null);
    useEffect(() => {
        const isValid = form.formState.isValid;
        if (prevIsValidRef.current !== isValid) {
            prevIsValidRef.current = isValid;
            onValidationChange?.(isValid);
        }
    }, [form.formState.isValid, onValidationChange]);

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h1 className="text-lg font-medium">可观测性设置</h1>
                <p className="text-muted-foreground text-sm mt-1">
                    配置 LangSmith trace 收集和节点耗时监控。改动会立即生效。
                </p>
            </header>
            <main>
                <Form {...form}>
                    <form className="space-y-8">
                        <FormField
                            control={form.control}
                            name="langsmith_enabled"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">启用 LangSmith Tracing</FormLabel>
                                        <FormDescription>
                                            开启后，每个节点的输入/输出/耗时会自动上报到 LangSmith Dashboard
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="langsmith_api_key"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>API Key</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-96"
                                            type="password"
                                            placeholder="lsv2_..."
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        从 https://smith.langchain.com/ 的 API Keys 页面复制
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="langsmith_project"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>项目名</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-96"
                                            placeholder="deepResearch"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        LangSmith Dashboard 里的项目分组名，同 LANGCHAIN_PROJECT 环境变量
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            </main>
        </div>
    );
};

ObservabilityTab.displayName = "Observability";
ObservabilityTab.icon = Activity;
ObservabilityTab.label = "可观测性";
