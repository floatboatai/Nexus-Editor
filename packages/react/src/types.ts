import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /**
   * Controlled markdown document. When provided, the parent owns the string and
   * should update it from `onChange`. External updates are applied with a silent
   * `setDocument` to avoid feedback loops.
   */
  value?: string;
};

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
