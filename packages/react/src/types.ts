import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
  /** 是否有可撤销的操作。由 historyChange 事件驱动，React 响应式。 */
  canUndo: boolean;
  /** 是否有可重做的操作。由 historyChange 事件驱动，React 响应式。 */
  canRedo: boolean;
}
