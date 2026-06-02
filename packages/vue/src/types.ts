import type { EditorAPI, EditorConfig } from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
