import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import styles from "./styles.module.css";
import { useStore } from "~/core/store";
import downApi from "~/core/api/down";
export interface HtmlDownDialogRef {
  showDialog: () => void;
}

interface HtmlDownDialogProps {
  reportId: string;
  fileName: string;
  checkpointId: string;
}

const HtmlDownDialog = forwardRef<HtmlDownDialogRef, HtmlDownDialogProps>(
  ({ reportId, fileName,checkpointId }, ref) => {
    const [internalVisible, setInternalVisible] = useState(false);
    const [numberingStyle, setNumberingStyle] = useState(0);
    const showDialog = () => {
      setInternalVisible(true);
    };

    useImperativeHandle(ref, () => ({
      showDialog,
    }));

    const handleClose = () => {
      setInternalVisible(false);
    };

    const handleCancel = () => {
      setInternalVisible(false);
    };

    const handleDownloadConfirm = async (numberingStyle: number) => {
      setInternalVisible(false);
      if (!reportId) {
        return;
      }
      const report = useStore.getState().messages.get(reportId);
      if (!report || !report.threadId) {
        return;
      }
      
      try {
        const resBlob = await downApi.downByHtml({
          thread_id: report.threadId,
          temp_num: numberingStyle,
          checkpoint_id: checkpointId || ""
        });
        
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const filename = `research-report-${timestamp}.docx`;
        
        if (resBlob && resBlob.size > 0) {
          // 创建下载链接
          const url = URL.createObjectURL(resBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 0);
        } else {
          console.error('下载的文件为空或无效');
        }
      } catch (error) {
        console.error('下载失败:', error);
      }
    };
    if (!internalVisible) {
      return null;
    }
    return (
      <Dialog open={internalVisible} onOpenChange={setInternalVisible}>
        <DialogTitle></DialogTitle>
        <DialogContent className={styles.dialogContent}>
          <DialogClose className={styles.closeButton} />
          <h3 className={styles.title}>下载设置</h3>

          <div className={styles.downloadSettingContent}>
            <div className={styles.cardContainer}>
              <div
                className={`${styles.customCard} ${numberingStyle === 0 ? styles.active : ""}`}
                onClick={() => setNumberingStyle(0)}
              >
                <div className={styles.h1}>标题 1</div>
                <div className={styles.h2}>标题 2</div>
                <div className={styles.txt}>模板一</div>
              </div>
              <div
                className={`${styles.customCard} ${numberingStyle === 1 ? styles.active : ""}`}
                onClick={() => setNumberingStyle(1)}
              >
                <div className={styles.h1}>一、标题 1</div>
                <div className={styles.h2}>（一）标题 2</div>
                <div className={styles.txt}>模板二</div>
              </div>
              <div
                className={`${styles.customCard} ${numberingStyle === 2 ? styles.active : ""}`}
                onClick={() => setNumberingStyle(2)}
              >
                <div className={styles.h1}>1. 标题 1</div>
                <div className={styles.h2}>1.1. 标题 2</div>
                <div className={styles.txt}>模板三</div>
              </div>
            </div>
          </div>
          <div className={styles.dialogFooter}>
            <Button variant="outline" onClick={handleCancel}>
              取消
            </Button>
            <Button
              className="w-24"
              type="submit"
              onClick={() => handleDownloadConfirm(numberingStyle)}
            >
              下载
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  },
);

export default HtmlDownDialog;
