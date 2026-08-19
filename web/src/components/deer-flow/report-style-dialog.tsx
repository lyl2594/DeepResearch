// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { useTranslations } from "next-intl";
import { useState, useMemo, useEffect } from "react";
import { Check, FileText, Newspaper, Users, GraduationCap, Blocks, Plus, MoreHorizontal } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from "~/components/ui/dialog";
import { setReportStyle, useSettingsStore } from "~/core/store";
import { useCustomStyleStore } from "~/core/store/customStyle-store";
import { cn } from "~/lib/utils";

import { Tooltip } from "./tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import templateAPI from "~/core/api/template";
import { message } from 'antd';
const REPORT_STYLES: any = [
  {
    value: "academic" as const,
    labelKey: "academic",
    descriptionKey: "academicDesc",
    icon: GraduationCap,
    iconKey:'academic',
    content:'',
    randomKey:'academic',
  },
  {
    value: "popular_science" as const,
    labelKey: "popularScience",
    descriptionKey: "popularScienceDesc",
    icon: FileText,
    iconKey:'popular_science',
    content:'',
    randomKey:'popular_science',
  },
  {
    value: "news" as const,
    labelKey: "news",
    descriptionKey: "newsDesc",
    icon: Newspaper,
    iconKey:'news',
    content:'',
    randomKey:'news',
  },
  {
    value: "social_media" as const,
    labelKey: "socialMedia",
    descriptionKey: "socialMediaDesc",
    icon: Users,
    iconKey:'social_media',
    content:'',
    randomKey:'social_media',
  },
];

export function ReportStyleDialog({ onCustomStyleClick,updateTime }: { onCustomStyleClick?: (val?: any) => void,updateTime:string }) {
  const t = useTranslations("settings.reportStyle");
  const [open, setOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

   const removeStyleList = useCustomStyleStore((state: any) => state.removeStyleList)
   
  const currentStyle = useCustomStyleStore((s) => s.defaultStyleId)
  const setDefaultStyleId = useCustomStyleStore((s) => s.setDefaultStyleId)
  // 1. 本地副本
  const [currentStyleCopy, setCurrentStyleCopy] = useState(currentStyle)

  // 2. 构造全新数组，不修改原对象
  const styleList = useCustomStyleStore((s) => s.styleList)



  useEffect(() => {
   if(!open) {
    setCurrentStyleCopy(currentStyle)
   }
  }, [open,currentStyle,styleList,updateTime])

  // 3. 计算当前配置
  const currentStyleConfig:any = useMemo(
    () => styleList.find((s:any) => s.id === currentStyle) || styleList[0],
    [styleList, currentStyle,updateTime]
  )
  const CurrentIcon = Users

  // 4. 页面内切换
  const handleStyleChange = (val: any) => {
    setCurrentStyleCopy(val)
  }

  // 5. 确认时再写回全局
  const onShure = () => {
    setDefaultStyleId(currentStyleCopy)
    setReportStyle(currentStyleCopy)
    setOpen(false)
  }

  const menuLick = (type: any,style:any) => {
    if(type == 'edit') {
      onCustomStyleClick?.(style)
    } else if(type == 'delete') {
      templateAPI.deleteTemplate(style.id).then(res=> {
        if(res?.message.indexOf('successfully') > -1) {
          messageApi.open({
            type: 'success',
            content: '删除成功',
          });
          if(currentStyleConfig.id == style.id) {
            setDefaultStyleId(styleList[0]?.id)
            setCurrentStyleCopy(styleList[0]?.id)
          }
          removeStyleList(style)
        }
      })
       
    }
  }
  return (
    <>
    {/* 必须渲染到页面上 */}
    {contextHolder}
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip
        className="max-w-60"
        title={
          <div>
            <h3 className="mb-2 font-bold">
              {t("writingStyle")}: {currentStyleConfig?.name }
            </h3>
            <p>{t("chooseDesc")}</p>
          </div>
        }
      >
        <DialogTrigger asChild>
          <Button
            className="!border-brand !text-brand rounded-2xl"
            variant="outline"
          >
            { currentStyleConfig?.iconKey == 'social_media' && <CurrentIcon className="h-4 w-4" /> }
            { currentStyleConfig?.iconKey == 'academic' && <img src="./images/academic-active.png" className="h-4 w-4" alt="" /> }
            { currentStyleConfig?.iconKey == 'popular_science' && <img src="./images/popular_science-active.png" className="h-4 w-4" alt="" /> }
            { currentStyleConfig?.iconKey == 'news' && <img src="./images/news-active.png" className="h-4 w-4" alt="" /> }
            { currentStyleConfig?.iconKey == 'custom' && <img src="./images/custom-active.png" className="h-4 w-4" alt="" /> }
            { currentStyleConfig?.name && <span className="max-over-text">{currentStyleConfig?.name}</span>}
          </Button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{t("chooseTitle")}</DialogTitle>
          <DialogDescription className="custom-dialog-desc">
            <span>{t("chooseDesc")}</span>
            <span className="add-custom-btn" onClick={() => onCustomStyleClick?.()}>
              <Plus size={16} /><span>添加报告模版</span>
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-4 style-dialog-content-box">
          {styleList.map((style: any) => {
            const Icon = Users;
            const isSelected = currentStyleCopy === style.id;

            return (
              <button
                 key={`${style.id}-${style.name}-${style.description}-${updateTime}`}
                className={cn(
                  "hover:bg-accent flex items-start gap-3 rounded-lg border p-4 text-left transition-colors relative style-select-button-box",
                  isSelected && "border-primary bg-accent",
                )}
                onClick={() => handleStyleChange(style.id)}
              >
                {/* <Icon className="mt-0.5 h-5 w-5 shrink-0" /> */}
                {style.iconKey == 'academic' && !isSelected && <img src="./images/academic.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'academic' && isSelected && <img src="./images/academic-active.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'popular_science' && !isSelected && <img src="./images/popular_science.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'popular_science' && isSelected && <img src="./images/popular_science-active.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'news' && !isSelected && <img src="./images/news.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'news' && isSelected && <img src="./images/news-active.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'social_media'  && <Icon className="mt-0.5 h-5 w-5 shrink-0" />}
                {style.iconKey == 'custom' && !isSelected && <img src="./images/custom.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                {style.iconKey == 'custom' && isSelected && <img src="./images/custom-active.png" className="mt-0.5 h-5 w-5 shrink-0" alt="" />}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium flex-1">{style.name}</h4>
                    {/* {isSelected && <Check className="text-primary h-4 w-4" />} */}
                    {
                     style.iconKey == 'custom'  && (
                        <div className="style-select-drop">
                      <DropdownMenu>
                        <Tooltip title="Change theme">
                          <DropdownMenuTrigger asChild>
                              <span><MoreHorizontal className="h-4 w-4" /></span>
                          </DropdownMenuTrigger>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            menuLick("edit",style)
                          }}>
                            <span>编辑</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            menuLick("delete",style)
                          }}>
                            <span>删除</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                       )
                    }
                  </div>
                  <p className="text-muted-foreground text-sm truncate max-w-[245px]">
                    {style.description}
                  </p>
                </div>
                {isSelected && <img src="./images/style-select.png" className="style-select-img" alt="" />}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button className="dialog-btn-cancel" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button className="dialog-btn-shure" type="submit" onClick={onShure}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
