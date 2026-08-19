// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

// 自定义写作风格 上传模版
import { useTranslations } from "next-intl";
import { forwardRef, useImperativeHandle, useState, useEffect, useRef,useCallback,useTransition, useMemo } from "react";
import { Check, FileText, Newspaper, Users, GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { setReportStyle, useSettingsStore } from "~/core/store";
import { useCustomStyleStore } from "~/core/store/customStyle-store";
import { cn } from "~/lib/utils";
import {
  Button,
  Form,
  Input,
  Progress,
  message, Upload
} from 'antd';
import ClearableSelect from './ClearableSelect'
const { Dragger } = Upload;


export interface CustomReportStyleDialogRef {
  showDialog: () => void;
}

interface CustomReportStyleDialogProps {
onUpdateClick?: () => void;
}
import templateAPI from "~/core/api/template";

export const CustomReportStyleDialog = forwardRef<CustomReportStyleDialogRef, CustomReportStyleDialogProps>(({ onUpdateClick }, ref) => {
  const t = useTranslations("settings.reportStyle");
  const [open, setOpen] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);

  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);      // 当前进度
  const [running, setRunning] = useState(false);  // 是否正在跑
  const [isPending, startTransition] = useTransition();

  const [messageApi, contextHolder] = message.useMessage();
  const addStyleList = useCustomStyleStore((state: any) => state.addStyleList)
  const updateStyleList = useCustomStyleStore((state) => state.updateStyleList);
  const styleList = useCustomStyleStore((s) => s.styleList)
  const [templateId,setTemplateId] = useState<string | undefined>('')
  const formatList = useMemo(() => {
    return styleList.filter(item=> item.is_builtin).map(item=> {
      return {
        value: item.id, 
        label: item.name,
        content: item.content,
        description: item.description
      }
    })
  }, [styleList])
  const [form] = Form.useForm();
  const formRef:any = useRef(null);
  const [isEdit,setIsEdit] = useState(false)
  const [editId,setEditId] = useState<any>('')
  useImperativeHandle(ref, () => ({
    showDialog: (val?: any) => {
      console.log(val)
      if (val&&val.id) {
        setIsEdit(true)
        setEditId(val.id)
        // 设置表单默认值
        form?.setFieldsValue({
          name: val.name,
          description: val.description,
          content: val.content,
          id: val.id
        })
      } else {
        setIsEdit(false)
      }
      setOpen(true)
    }
  }));
  const onFinish = (values: any) => {
    if(isEdit) {
      let obj = {
        name:values.name,
        description: values.description,
        content: values.content,
        id: editId
      }
      templateAPI.updateTemplate(obj).then(res=> {
         if(res?.message && res?.message.indexOf('successfully') > -1) {
           updateStyleList({
             name:values.name,
              description: values.description,
              iconKey: 'custom',
              id:editId,
              content: values.content
            })
            messageApi.open({
              type: 'success',
              content: '修改成功',
            });
            onUpdateClick?.();
         }
      })

    } else {
      let obj = {
        name:values.name,
        description: values.description,
        content: values.content
      }
      templateAPI.addTemplate(obj).then(res=> {
        if(res?.id) {
          addStyleList({
            name:values.name,
            description: values.description,
            iconKey: 'custom',
            id:res.id,
            content: values.content
          })
          messageApi.open({
            type: 'success',
            content: '添加成功',
          });
        }
      })
    }
    setOpen(false)
    onReset()
  };

  const onReset = () => {
    form.resetFields();
  };
  const cancelDialog = () => {
    setOpen(false)
    onReset() 
    setFileList([])
  }
  /* 校验规则 */
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  const ACCEPT_TYPE = ["md","markdown"];
    // 提取文件名（去除后缀）
  const extractFileName = (filename: string) => {
    if (!filename) return '';
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex === -1 ? filename : filename.substring(0, lastDotIndex);
  };
  /* 手动上传函数 */
  const customUpload = async (file: File): Promise<void> => {
    setFileList([file])
    const body = new FormData();
    body.append("file", file);
     setPercent(0);
      // 模拟上传进度
      for (let i = 0; i <= 100; i += 10) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // 模拟延迟
        setPercent(i);
      }
    templateAPI.uploadTemplate(body).then(res=> {
       if(res.filename) {
          formRef?.current?.setFieldsValue({
            name:extractFileName(res.filename) || '',
            description:res?.description || '',
            content: res?.content || ''
          });
       }
    }).finally(()=> {
      setPercent(100);
    })
  };
  const uploadProps: any = {
    name: 'file',
    multiple: false,
    action: '#',
    showUploadList: false,
    beforeUpload(file: any) {
      const { type, size, name } = file;
      // 获取文件扩展名
    const fileExtension = name.split(".").pop().toLowerCase();
      /* 类型校验 */
      if (!ACCEPT_TYPE.includes(fileExtension)) {
        messageApi.open({
          type: 'warning',
          content: `不支持该类型：${name}`,
        });
        setFileList([])
        return Upload.LIST_IGNORE; // 阻止继续
      }

      // /* 大小校验 */
      if (size > MAX_SIZE) {
        messageApi.open({
          type: 'warning',
          content: `文件超出 2MB：${name}`,
        });
        setFileList([])
        return Upload.LIST_IGNORE; // 阻止继续
      }
      /* 校验通过 -> 手动上传 */
      customUpload(file);
    },
    onChange(info: any) {
      
    },
    onDrop(e: any) {
      // console.log('Dropped files', e.dataTransfer.files);
    },
  };


    // 统一关闭回调
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);

    // 只要变成 false，就说明“要关了”
    if (!nextOpen) {
      cancelDialog()
    }
  }, []);

  const onChangeDefault = (value: string | undefined) => {
    if (value) {
      let item = formatList.find((item: any)=> item.value == value)
      if(item) {
        formRef?.current?.setFieldsValue({
              name:item.label || '',
              description:item?.description || '',
              content: item?.content || ''
            });
      }
    }
  }
  const onClear = ()=> {
   setTemplateId(undefined)
  }
  return (
    <>
    {/* 必须渲染到页面上 */}
    {contextHolder}
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>添加模版</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <div className="upload-box-dialog">
          <div className="upload-box-empty">
            <Dragger {...uploadProps} >
              {
                fileList.length == 0 && (

                  <div className="flex flex-col items-center justify-center">
                    <img className="upload-box-empty-img" src="./images/upload.png" alt="" />
                    <div className="upload-box-empty-text">将文件拖到此处，或<span className="upload-box-empty-text-btn">点击上传</span></div>
                    <div className="upload-box-empty-text-desc">上传的模板内容会替换当前已编辑的模板内容！</div>
                  </div>

                )
              }
              {
                fileList.length > 0 && (
                  <div className="upload-box-upload">
                    <div className="upload-box-upload-file">
                      <span className="upload-box-upload-file-name">{fileList[0]?.name}</span><span className="upload-box-empty-text-btn">重新上传</span>
                    </div>
                    <div className="upload-box-upload-progress">
                      { percent == 0 && <Progress percent={percent} />}
                      { percent > 0 && <Progress percent={percent} />}
                      <div>{percent === 100?'已完成':'上传中'}</div>
                    </div>
                  </div>
                )
              }

            </Dragger>
          </div>
        </div>
        <div className="form-top-huo text-center">或</div>
        <ClearableSelect 
          items={formatList.map((item: any) => ({ label: item.label, value: item.value }))}
          placeholder="选择现有模版"
          value={templateId}
          onValueChange={onChangeDefault}
          onClear={onClear}
        />
        <Form
        ref={formRef}
          form={form}
          onFinish={onFinish}
          layout="vertical"
        >
          <Form.Item label="模版名称" name="name" rules={[{ required: true, message: '请输入模版名称' }]}>
            <Input placeholder="请输入模版名称" />
          </Form.Item>
          <Form.Item
            label="模版描述"
            name="description"
            rules={[{ required: true, message: '请输入模版描述' }]}
          >
            <Input placeholder="请输入模版描述" />
          </Form.Item>
          <Form.Item
            label="模版内容"
            name="content"
            rules={[{ required: true, message: '请输入模版内容' }]}
          >
            <Input.TextArea placeholder="请输入模版内容" autoSize={{ minRows: 8, maxRows: 10 }} />
          </Form.Item>
          <Form.Item>
            <div className="submit-btn-box">
              <Button className="submit-btn-cancel-ant" onClick={cancelDialog}>
                取消
              </Button>
              <Button className="submit-btn-shure-ant ml-2.5" type="primary" htmlType="submit">
                确定
              </Button>
            </div>
          </Form.Item>
        </Form>

      </DialogContent>
    </Dialog>
    </>
  );
});

