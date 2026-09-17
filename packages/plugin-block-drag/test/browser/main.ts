import { history } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createBlockDragExtension } from "../../src/extension";

const drag = new Compartment();
const readonly = new Compartment();
let view!: EditorView;
const documentElement = document.querySelector<HTMLElement>("#markdown")!;
const editor = createEditor({
  container: document.querySelector<HTMLElement>("#editor")!,
  initialValue: "First paragraph\n\nSecond paragraph\n\nThird paragraph",
  livePreview: new URLSearchParams(location.search).get("preview") !== "false",
  plugins: [
    createGfmPreset(),
    {
      name: "acceptance",
      cmExtensions: [
        history(),
        drag.of(createBlockDragExtension()),
        readonly.of([]),
        ViewPlugin.define(instance => {
          view = instance;
          return {};
        }),
      ],
    },
  ],
  onChange: document => {
    documentElement.textContent = document;
  },
});
documentElement.textContent = editor.getDocument();
let rejected = 0;
const fixture = {
  editor,
  view,
  load(source: string): void {
    editor.setDocument(source);
    documentElement.textContent = editor.getDocument();
  },
  enable(enabled: boolean): void {
    view.dispatch({ effects: drag.reconfigure(enabled ? createBlockDragExtension() : []) });
  },
  readOnly(enabled: boolean): void {
    view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(enabled)) });
  },
  rejectCellSave(): () => void {
    const registration = editor.getContributionSink().registerTransactionFilter(
      "acceptance-cell-guard",
      context => {
        if (context.changes.some(change => change.insert.includes("UNSAVED"))) {
          rejected++;
          return { action: "reject" };
        }
        return { action: "accept" };
      },
    );
    return () => registration.dispose();
  },
  rejected: () => rejected,
};
Object.assign(window, { fixture });
