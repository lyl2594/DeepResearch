// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { env } from "~/env";

export function resolveServiceURL(path: string) {
  // 客户端：读取注入的全局变量，如果未定义则使用默认值
  // 服务端：使用环境变量或默认值
  let BASE_URL = (typeof window !== 'undefined'
    ? window.__NEXT_PUBLIC_API_URL__ ?? env.NEXT_PUBLIC_API_URL
    : env.NEXT_PUBLIC_API_URL) ?? "http://localhost:8000/api/";
  
  if (!BASE_URL.endsWith("/")) {
    BASE_URL += "/";
  }
  return new URL(path, BASE_URL).toString();
}
