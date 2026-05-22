import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Called once after the editor is created on first mount. */
  onReady?: (editor: EditorAPI) => void;
};

/** DOM attrs that share names with EditorConfig callbacks are omitted from container passthrough. */
type EditorContainerAttributes = Omit<
  HTMLAttributes,
  "children" | "ref" | "onChange" | "onFocus" | "onBlur"
>;

export type EditorProps = UseEditorConfig & EditorContainerAttributes;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
