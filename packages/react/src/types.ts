import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { ComponentPropsWithoutRef, RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Called once after the editor instance is created and mounted. */
  onReady?: (editor: EditorAPI) => void;
};

export type EditorContainerProps = Omit<
  ComponentPropsWithoutRef<"div">,
  keyof UseEditorConfig | "children" | "ref"
>;

export type EditorProps = UseEditorConfig & EditorContainerProps;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
