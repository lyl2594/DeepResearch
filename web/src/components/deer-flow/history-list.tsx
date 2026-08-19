// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

// 历史记录列表 弹出层
import { useTranslations } from "next-intl";
import { forwardRef, useImperativeHandle, useState, useEffect, useRef, useCallback, useTransition } from "react";
import {  CirclePlay, Trash2, Clock3 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
    ScrollContainer,
    type ScrollContainerRef,
} from "~/components/deer-flow/scroll-container";
import { Button } from "~/components/ui/button";

export interface ContentDialogRef {
    showDialog: () => void;
}



export const HistoryListDialog = forwardRef<ContentDialogRef>((props, ref) => {
    const [open, setOpen] = useState(false);
    const [list, setList] = useState([
        {name:'123',title:'123',id:'1'},
        {name:'123',title:'123',id:'2'},
        {name:'123',title:'123',id:'3'},
        {name:'123',title:'123',id:'4'},
    ]);
    const [selectId,setSelectId] = useState('')
    useImperativeHandle(ref, () => ({
        showDialog: (val?: any) => {
            if (val.content) {
                setOpen(true)
            }
        }
    }));
    const cancelDialog = () => {
        setOpen(false)
    }
    // 统一关闭回调
    const handleOpenChange = useCallback((nextOpen: boolean) => {
        setOpen(nextOpen);

        // 只要变成 false，就说明“要关了”
        if (!nextOpen) {
            cancelDialog()
        }
    }, []);
    const onSelect = (val: string) =>{
      setSelectId(val)
    }
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[900px]">
                <DialogHeader>
                    <DialogTitle>历史记录</DialogTitle>
                </DialogHeader>
                <div className="flex h-150 w-full overflow-y-auto markdown-dialog">
                    <ScrollContainer
                        className={cn(
                            "flex h-full w-full flex-col overflow-hidden",
                        )}
                        scrollShadow={false}
                    >
                        <div className="px-4 py-2">
                            {
                                list.map((item: any, index: number) => {
                                    return (
                                        <div className={`history-list-box ${selectId === item.id?'select-item':''}`} key={index} onClick={()=>onSelect(item.id)}>
                                                <div className="flex items-center history-list-content  p-[14px] rounded-[6px]">
                                                    <div className="history-list-left self-start">
                                                    <Clock3 className="color16626e" size={14} />
                                                </div>
                                                <div className="flex flex-col flex-1 items-start history-list-center ml-[14px] mr-[14px]">
                                                    <div className="history-list-title">{item.name}</div>
                                                    <div className="history-list-time">{item.title}</div>
                                                </div>
                                                <div className="flex items-center history-list-right">
                                                    <Button variant="ghost" size="icon"><CirclePlay /></Button>
                                                    <Button variant="ghost" size="icon"><Trash2 /></Button>
                                                </div>
                                                </div>
                                        </div>
                                    )
                                })
                            }
                        </div>
                    </ScrollContainer>
                </div>
            </DialogContent>
        </Dialog>
    );
});

