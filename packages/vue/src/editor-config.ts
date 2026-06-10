import type { EditorConfig } from "@floatboat/nexus-core";

import type { UseEditorConfig } from "./types";

export function toCreateEditorConfig(
  config: UseEditorConfig
): Omit<EditorConfig, "container"> {
  const { onReady: _onReady, ...editorConfig } = config;
  return editorConfig;
}

export function pickEditorConfig(source: Record<string, unknown>): UseEditorConfig {
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      config[key] = value;
    }
  }

  return config as UseEditorConfig;
}
