/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import "./src/env.js";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import("next").NextConfig} */

// DeerFlow leverages **Turbopack** during development for faster builds and a smoother developer experience.
// However, in production, **Webpack** is used instead.
//
// This decision is based on the current recommendation to avoid using Turbopack for critical projects, as it
// is still evolving and may not yet be fully stable for production environments.

const config = {
  // For development mode
  turbopack: {
    rules: {
      "*.md": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },

  // For production mode
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      use: "raw-loader",
    });
    return config;
  },

  // ... rest of the configuration.
  output: "standalone",
  // 忽略 TypeScript 构建错误
  typescript: {
    ignoreBuildErrors: true,
  },
  // 忽略 ESLint 构建错误
  eslint: {
    ignoreDuringBuilds: true,
  },
    async rewrites() {
      // 后端代理目标：默认本地 8000，可用环境变量覆盖（生产请指向部署的后端）
      const apiBase = (
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"
      ).replace(/\/+$/, "");
      return [
        {
          source: "/api/:path*",
          destination: `${apiBase}/:path*`,
        },
      ];
    },
};

export default withNextIntl(config);
