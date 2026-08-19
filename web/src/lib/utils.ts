/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getReportStyleTitleById(id?: string) {
  const string:any = localStorage.getItem("customStyleSettings");
  let array = []
  if(string) {
    array = JSON.parse(string)
    return array.find((item:any) => item.id === id)?.name || array[0]?.name;
  }
  return '学术'
}