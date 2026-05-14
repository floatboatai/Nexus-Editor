import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  /**
   * Callback invoked when the editor instance is created and ready.
   * Use this to access the editor API immediately after initialization.
   */
  onReady?: (editor: EditorAPI) => void;
}

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
