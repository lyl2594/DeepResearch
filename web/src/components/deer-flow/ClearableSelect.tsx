'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"

type Item = { label: string; value: string };

interface ClearableSelectProps {
  items: Item[];
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string | undefined) => void;
  onClear?: () => void;
}

export default function ClearableSelect({
  items,
  placeholder = '请选择…',
  value,
  onValueChange,
  onClear,
}: ClearableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState<string | undefined>(value);

  // 同步外部value变化
  React.useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue);
    onValueChange?.(newValue);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalValue('');
    onValueChange?.('');
    onClear?.();
    setOpen(false);
  };

  return (
    <div className="select-clear-box">
    <Select open={open} onOpenChange={setOpen} value={internalValue} onValueChange={handleValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value}>
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
      {/* 下拉三角右侧始终显示；有值时再显示 × */}
        {internalValue && (<div className="ml-auto flex items-center gap-2 select-clear">
            <X
              className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            />
        </div>
        )}
    </div>
  );
}