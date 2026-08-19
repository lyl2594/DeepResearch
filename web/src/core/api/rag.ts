import type { Resource } from "../messages";

import type { KnowledgeBasePlatform } from "~/typings/knowledge-base";
import { resolveServiceURL } from "./resolve-service-url";

export interface KnowledgeBaseConfig {
  id?: string;
  user_id?: string;
  name: string;
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
  retrieval_size: number;
  similarity: number;
  enabled?: boolean;
  is_enabled?: boolean;
}

export interface SaveKnowledgeBaseParams {
  id?: string;
  user_id?: string;
  name: string;
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
  retrieval_size: number;
  similarity: number;
  is_enabled?: boolean;
}

export async function queryRAGResources(query: string) {
  const params = new URLSearchParams({ query });
  return fetch(resolveServiceURL(`rag/resources?${params.toString()}`), {
    method: "GET",
  })
    .then((res) => res.json())
    .then((res) => {
      return res.resources as Array<Resource>;
    })
    .catch(() => {
      return [];
    });
}

export async function saveKnowledgeBaseConfig(config: SaveKnowledgeBaseParams) {
  const res = await fetch(resolveServiceURL("config/rag/save_config"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  // 检查响应状态
  if (!res.ok) {
    // 尝试解析 JSON 错误响应
    const errorData = await res.json().catch(() => ({}));
    // 获取错误消息（优先级：message > error > statusText）
    const errorMessage = errorData.message || errorData.error || errorData.detail || res.statusText || "Failed to save knowledge base config";
    // 创建包含详细信息的错误对象
    const error = new Error(errorMessage) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = errorData;
    throw error;
  }

  return res.json();
}

export async function updateKnowledgeBaseConfig(
  configId: string,
  config: Partial<KnowledgeBaseConfig>
) {
  return fetch(resolveServiceURL(`config/rag/${configId}`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || res.statusText);
      }
      return res.json();
    })
    .catch((error) => {
      console.error("Failed to update knowledge base config:", error);
      throw error;
    });
}

export async function getKnowledgeBaseConfigs() {
  return fetch(resolveServiceURL("config/rag/get_config"), {
    method: "GET",
  })
    .then((res) => res.json())
    .catch((error) => {
      console.error("Failed to get knowledge base configs:", error);
      throw error;
    });
}

export async function deleteKnowledgeBaseConfig(configId: string) {
  return fetch(resolveServiceURL(`config/rag/${configId}`), {
    method: "DELETE",
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || res.statusText);
      }
      return res.json();
    })
    .catch((error) => {
      console.error("Failed to delete knowledge base config:", error);
      throw error;
    });
}

// ============================================================
// 增量④ AIHUB 扩展：AIHUB 的凭据放在 ext_config 里，复用上面的通用 CRUD。
// 下面提供 AIHUB 专用的类型和便捷函数。
// ============================================================

/** AIHUB 平台的 ext_config 结构 */
export interface AihubExtConfig {
  username: string;
  password: string;
}

/** 保存 AIHUB 知识库的简化参数（不需要手动拼 ext_config） */
export interface SaveAihubParams {
  name: string;
  api_url: string;
  username: string;
  password: string;
  retrieval_size?: number;
  similarity?: number;
}

/**
 * 保存 AIHUB 知识库配置的便捷函数。
 * 内部把 username / password 包装进 ext_config，调用通用 saveKnowledgeBaseConfig。
 */
export async function saveAihubConfig(params: SaveAihubParams) {
  return saveKnowledgeBaseConfig({
    name: params.name,
    platform: "aihub",
    api_url: params.api_url,
    ext_config: {
      username: params.username,
      password: params.password,
    },
    retrieval_size: params.retrieval_size ?? 10,
    similarity: params.similarity ?? 0.6,
    is_enabled: true,
  });
}

export type TestConnectionResponse = {
  success: boolean;
  resource_count: number;
  message: string;
};

export async function testKnowledgeBaseConnection(params: {
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
}) {
  const res = await fetch(resolveServiceURL("config/rag/test_connection"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage =
      errorData.message || errorData.error || errorData.detail || res.statusText ||
      "Failed to test knowledge base connection";
    const error = new Error(errorMessage) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = errorData;
    throw error;
  }

  return res.json();
}
