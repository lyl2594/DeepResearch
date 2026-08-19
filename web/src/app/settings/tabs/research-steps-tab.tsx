// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
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
import type { SettingsState } from "~/core/store";
import type { Tab } from "./types";

// 定义表单验证规则
const researchStepsFormSchema = z.object({
    max_step_retry: z.number({
        required_error: '最大重试次数不能为空',
        invalid_type_error: '最大重试次数必须是数字'
    }).min(0, { message: '最大重试次数不能小于0' })
        .max(10, { message: '最大重试次数不能大于10' }),

    min_step_score: z.number({
        required_error: '最低步骤评分不能为空',
        invalid_type_error: '最低步骤评分必须是数字'
    }).min(0, { message: '最低步骤评分不能小于0' })
        .max(1, { message: '最低步骤评分不能大于1' })
});

export const ResearchStepsTab: Tab = ({
    settings,
    onChange,
    onValidationChange,
}: {
    settings: SettingsState;
    onChange: (changes: Partial<SettingsState>) => void;
    onValidationChange?: (isValid: boolean) => void;
}) => {
    const t = useTranslations("settings.general");

    // 从设置中获取研究步骤配置，如果没有则使用默认值
    const researchStepsSettings = useMemo(() => ({
        max_step_retry: settings.general.max_step_retry ? Number(settings.general.max_step_retry) : 3,
        min_step_score: settings.general.min_step_score ? Number(settings.general.min_step_score) : 0.5
    }), [settings]);

    const form = useForm<z.infer<typeof researchStepsFormSchema>>({
        resolver: zodResolver(researchStepsFormSchema, undefined, undefined),
        defaultValues: researchStepsSettings,
        mode: "all",
        reValidateMode: "onBlur",
    });

    // 监听表单值变化并更新设置
    const currentSettings = form.watch();
    useEffect(() => {
        const hasChanges = Object.keys(currentSettings).some(key => {
            const currentValue = currentSettings[key as keyof typeof currentSettings];
            const settingsValue = settings.general[key as keyof SettingsState["general"]];
            return Number(currentValue) !== Number(settingsValue);
        });

        if (hasChanges) {
            onChange({
                general: {
                    ...settings.general,
                    ...currentSettings
                }
            });
        }
    }, [currentSettings, onChange, settings]);

    // 监听表单验证状态变化
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
                <h1 className="text-lg font-medium">研究步骤配置</h1>
            </header>
            <main>
                <Form {...form}>
                    <form className="space-y-8">
                        <FormField
                            control={form.control}
                            name="max_step_retry"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>最大重试次数</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-60"
                                            type="number"
                                            min={0}
                                            max={10}
                                            value={field.value}
                                            onChange={(event) => {
                                                const value = parseInt(event.target.value);
                                                field.onChange(value);
                                            }}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        每个研究步骤在失败时的最大重试次数
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="min_step_score"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>评分阈值</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-60"
                                            type="number"
                                            step="0.1"
                                            min={0}
                                            max={1}
                                            value={field.value}
                                            onChange={(event) => {
                                                const value = parseFloat(event.target.value);
                                                field.onChange(value);
                                            }}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        当步骤评分低于此阈值时，将触发重试 (0-1之间)
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

ResearchStepsTab.displayName = "研究步骤配置";
ResearchStepsTab.icon = Settings;
