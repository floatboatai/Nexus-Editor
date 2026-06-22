import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, RefObject } from "react";

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Fires once after the editor instance is created, handing back the EditorAPI handle. */
  onReady?: (editor: EditorAPI) => void;
};

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}

export interface EditorProps extends UseEditorConfig {
  /** Forwarded verbatim onto the editor's root container <div> (className / style / id / data-* / aria-*). */
  containerProps?: HTMLAttributes<HTMLDivElement> &
    Record<`data-${string}`, string | number | boolean | undefined>;
}
