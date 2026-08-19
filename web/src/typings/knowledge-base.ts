/**
 * 知识库平台类型
 */
export type KnowledgeBasePlatform = "ragflow" | "dify" | "aihub" | "es";

/**
 * 知识库配置接口
 */
export interface KnowledgeBaseConfig {
  id: string;
  user_id: string;
  platform: KnowledgeBasePlatform;
  name: string;
  api_url: string;
  ext_config: Record<string, string>;
  retrieval_size: number;
  similarity: number;
  enabled: boolean;
}
