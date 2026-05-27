export interface AIConfig {
  apiKey: string;
  provider: "doubao";
  model: string;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  apiKey: "", // 通过环境变量 NEXUS_AI_API_KEY 配置
  provider: "doubao",
  model: "doubao-seed-2-0-lite-260428",
};
