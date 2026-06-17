import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  onReady?: (editor: EditorAPI) => void;
}

export interface EditorProps extends UseEditorConfig {
  class?: string;
  style?: string | Record<string, string>;
  id?: string;
}

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
