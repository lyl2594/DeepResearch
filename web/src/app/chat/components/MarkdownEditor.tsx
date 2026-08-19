import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

interface TiptapEditorProps {
  defaultValue: any;
  onContentChange?: (content: string) => void;
  syncWithDefaultValue?: boolean; // 新增属性，控制是否在defaultValue更改时更新编辑器内容
}

// 使用forwardRef和useImperativeHandle暴露组件方法
const TiptapEditor = forwardRef<any, TiptapEditorProps>(
  ({ defaultValue, onContentChange, syncWithDefaultValue = true }, ref) => {
    const editor = useEditor({
      extensions: [StarterKit],
      content: defaultValue,
      onUpdate: ({ editor }) => {
        onContentChange && onContentChange(editor.getHTML());
      },
    });

    // 只在初始化或syncWithDefaultValue为true时设置默认值
    useEffect(() => {
      if (editor && syncWithDefaultValue && defaultValue !== editor.getHTML()) {
        editor.commands.setContent(defaultValue);
      }
    }, [defaultValue, editor, syncWithDefaultValue]);

    // 暴露编辑器方法给父组件
    useImperativeHandle(ref, () => ({
      getContent: () => editor?.getText() || "",
      setContent: (content: string) => {
        editor?.commands.setContent(content);
      },
    }), [editor]);

    return <EditorContent editor={editor} className="markdown-editor-custom" />;
  }
);

TiptapEditor.displayName = 'TiptapEditor';

export default TiptapEditor;