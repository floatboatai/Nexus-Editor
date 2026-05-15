import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { CSSProperties, RefObject } from "react";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  onReady?: (editor: EditorAPI) => void;
}

export interface ContainerProps {
  className?: string;
  id?: string;
  style?: CSSProperties;
  [key: `data-${string}`]: string;
}

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
