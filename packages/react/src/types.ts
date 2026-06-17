import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { CSSProperties, RefObject } from "react";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  onReady?: (editor: EditorAPI) => void;
}

export interface EditorProps extends UseEditorConfig {
  className?: string;
  style?: CSSProperties;
  id?: string;
}

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
