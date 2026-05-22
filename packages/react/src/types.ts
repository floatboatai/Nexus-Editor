import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Called once after the editor is created on first mount. */
  onReady?: (editor: EditorAPI) => void;
};

/** DOM attrs that share names with EditorConfig callbacks are omitted from container passthrough. */
type EditorContainerAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "ref" | "onChange" | "onFocus" | "onBlur"
>;

export type EditorProps = UseEditorConfig & EditorContainerAttributes;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
