import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef, StyleValue } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface EditorComponentProps extends UseEditorConfig {
  /** CSS class name(s) applied to the container div. */
  class?: string | Record<string, boolean> | string[];
  /** Inline styles applied to the container div. */
  style?: StyleValue;
}

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
