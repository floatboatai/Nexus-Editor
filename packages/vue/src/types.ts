import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /**
   * Called once after the editor instance is created and attached to the DOM.
   * Receives the EditorAPI so callers don't need a separate ref for
   * imperative access.
   */
  onReady?: (editor: EditorAPI) => void;
};

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
