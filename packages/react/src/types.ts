import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { CSSProperties, RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /**
   * Called once after the editor instance is created and attached to the DOM.
   * Receives the EditorAPI so callers don't need a separate ref for
   * imperative access.
   */
  onReady?: (editor: EditorAPI) => void;
};

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}

export interface EditorProps extends UseEditorConfig {
  /** CSS class applied to the editor container div. */
  className?: string;
  /** Inline styles applied to the editor container div. */
  style?: CSSProperties;
}
