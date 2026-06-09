import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, Ref, ShallowRef } from "vue";

export interface UseEditorConfig extends Omit<EditorConfig, "container"> {
  onReady?: (editor: EditorAPI) => void;
}

export type EditorProps = UseEditorConfig &
  Omit<HTMLAttributes, keyof UseEditorConfig | "ref">;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
