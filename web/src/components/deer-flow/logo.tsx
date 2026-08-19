// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { env } from "~/env";

export function Logo() {
  return (
    <Link
      className="opacity-70 transition-opacity duration-300 hover:opacity-100 chat-logo-box"
      href="/"
    >
      <img className="chat-logo" src="./images/chat-logo.png" alt="" />
      {/* 🦌 {env.NEXT_PUBLIC_TITLE} */}
    </Link>
  );
}
