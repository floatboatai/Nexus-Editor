import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /**
   * Controlled markdown document (use with `v-model`). When provided, the
   * parent owns the string; external updates use silent `setDocument`.
   */
  modelValue?: string;
};

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
