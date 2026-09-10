import { Facet } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

export const headlessSearchMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

export interface HeadlessSearchActions {
  open(): void;
  close(): boolean;
  next(): Promise<unknown>;
  previous(): Promise<unknown>;
}

export const headlessActions = new WeakMap<EditorView, HeadlessSearchActions>();

export function headlessSearchExtensions() {
  return [
    headlessSearchMode.of(true),
    keymap.of([
      { key: "Mod-f", run: (view) => { headlessActions.get(view)?.open(); return true; } },
      { key: "F3", run: (view) => { void headlessActions.get(view)?.next(); return true; } },
      { key: "Shift-F3", run: (view) => { void headlessActions.get(view)?.previous(); return true; } },
      { key: "Mod-g", run: (view) => { void headlessActions.get(view)?.next(); return true; } },
      { key: "Mod-Shift-g", run: (view) => { void headlessActions.get(view)?.previous(); return true; } },
      { key: "Escape", run: (view) => headlessActions.get(view)?.close() ?? false },
    ]),
  ];
}
