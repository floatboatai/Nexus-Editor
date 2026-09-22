import { Facet } from "@codemirror/state";
import type { Command } from "@codemirror/view";

/** An alternative history backend, such as selective CRDT undo. */
export interface EditorHistory {
  undo: Command;
  redo: Command;
}

/** Overrides public undo/redo; an empty backend does not fall back to local history. */
export const editorHistory = Facet.define<EditorHistory, EditorHistory | null>({
  combine(values) {
    if (values.length > 1) throw new Error("Only one editor history backend may be installed");
    return values[0] ?? null;
  },
});
