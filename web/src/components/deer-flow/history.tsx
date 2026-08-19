import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import { useRef } from "react";
import { ArrowUp, Lightbulb, Search, X } from "lucide-react";
import { HistoryListDialog } from "~/components/deer-flow/history-list"
export function HistoryBox() {
    const historyListDialogRef:any = useRef(null)
    function onShow() {
        historyListDialogRef?.current?.showDialog()
    }
    return (
        <>
                {/* <Tooltip title="历史记录">
            <Button asChild variant="ghost" size="icon" onClick={onShow}>
                <Search />
            </Button>
        </Tooltip>
        <HistoryListDialog ref={historyListDialogRef}></HistoryListDialog> */}
        </>
    )
}