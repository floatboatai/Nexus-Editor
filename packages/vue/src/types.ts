import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { Ref, ShallowRef } from "vue";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}

/**
 * Props accepted by the `<Editor />` component.
 *
 * Includes every {@link UseEditorConfig} field plus an optional `onReady`
 * callback that fires once the editor instance has been created. Any
 * additional HTML attributes (class, style, data-*, aria-*, …) are
 * forwarded to the container `<div>` via Vue's fallthrough attrs.
 */
export type EditorProps = UseEditorConfig & {
  /** Fired once after the editor instance is created. Receives the {@link EditorAPI}. */
  onReady?: (editor: EditorAPI) => void;
};
