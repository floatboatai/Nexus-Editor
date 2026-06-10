import type { EditorConfig } from "@floatboat/nexus-core";

import type { UseEditorConfig } from "./types";

export function toCreateEditorConfig(
  config: UseEditorConfig
): Omit<EditorConfig, "container"> {
  const { onReady: _onReady, ...editorConfig } = config;
  return editorConfig;
}
