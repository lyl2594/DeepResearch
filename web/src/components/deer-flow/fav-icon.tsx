// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { cn } from "~/lib/utils";

const FALLBACK_FAVICON =
  "https://perishablepress.com/wp/wp-content/images/2021/favicon-standard.png";

// 搜索结果里的 url 可能缺协议（www.xxx）、是协议相对（//xxx）或是空串/非字符串，
// 直接 new URL(url) 会抛 "Failed to construct 'URL': Invalid URL" 导致整个组件崩掉。
// 这里先归一化补齐协议，再构造 favicon 地址；任何异常都回退到默认图标。
function buildFaviconSrc(url: string): string {
  if (typeof url !== "string" || !url.trim()) return FALLBACK_FAVICON;
  let u = url.trim();
  if (u.startsWith("//")) u = `https:${u}`;
  else if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u).origin + "/favicon.ico";
  } catch {
    return FALLBACK_FAVICON;
  }
}

export function FavIcon({
  className,
  url,
  title,
}: {
  className?: string;
  url: string;
  title?: string;
}) {
  return (
    <img
      className={cn("bg-accent h-4 w-4 rounded-full shadow-sm", className)}
      width={16}
      height={16}
      src={buildFaviconSrc(url)}
      alt={title}
      onError={(e) => {
        e.currentTarget.src = FALLBACK_FAVICON;
      }}
    />
  );
}
