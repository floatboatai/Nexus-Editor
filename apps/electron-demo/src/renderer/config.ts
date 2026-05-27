export interface AIConfig {
  apiKey: string;
  provider: "doubao";
  model: string;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  apiKey: "ark-59ea0c9f-4244-4ba1-9de2-fed4288e3467-d5707",
  provider: "doubao",
  model: "doubao-seed-2-0-lite-260428",
};
