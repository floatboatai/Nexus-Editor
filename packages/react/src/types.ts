import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container">;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}

/**
 * Props accepted by the `<Editor />` component.
 *
 * Includes every {@link UseEditorConfig} field, plus standard HTML `<div>`
 * attributes (className, style, data-*, aria-*, …) that are forwarded to
 * the container element, and an optional `onReady` callback that fires
 * once the editor instance has been created.
 */
export type EditorProps = UseEditorConfig &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof UseEditorConfig> & {
    /** Fired once after the editor instance is created. Receives the {@link EditorAPI}. */
    onReady?: (editor: EditorAPI) => void;
  };
