import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { CSSProperties, RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface EditorComponentProps extends UseEditorConfig {
  /** CSS class name applied to the container div. */
  className?: string;
  /** Inline styles applied to the container div. */
  style?: CSSProperties;
}

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
