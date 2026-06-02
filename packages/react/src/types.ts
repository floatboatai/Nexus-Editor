import type { EditorAPI, EditorConfig } from "@floatboat/nexus-core";
import type { RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
