import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, RefObject } from "react";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  onReady?: (editor: EditorAPI) => void;
}

export type EditorProps = UseEditorConfig &
  Omit<HTMLAttributes<HTMLDivElement>, keyof UseEditorConfig | "children">;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
