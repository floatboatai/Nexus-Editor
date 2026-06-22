import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Fires once after the editor instance is created, handing back the EditorAPI handle. */
  onReady?: (editor: EditorAPI) => void;
};

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}

/** DOM attributes forwarded verbatim onto the editor's root container <div>. */
export type EditorContainerProps = HTMLAttributes;
