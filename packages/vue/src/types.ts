import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
  /** 是否有可撤销的操作。由 historyChange 事件驱动，Vue 响应式。 */
  canUndo: Ref<boolean>;
  /** 是否有可重做的操作。由 historyChange 事件驱动，Vue 响应式。 */
  canRedo: Ref<boolean>;
}
