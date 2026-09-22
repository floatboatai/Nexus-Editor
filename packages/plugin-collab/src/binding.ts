import { historyField } from "@codemirror/commands";
import { EditorState, Prec, StateField, Text, Transaction, type ChangeSpec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { editorHistory, editorTransactionOrigin } from "@floatboat/nexus-core";
import * as Y from "yjs";

import { captureSelection, restoreSelection, type RelativeSelection } from "./selection";
import { unicodeTransactions } from "./unicode";

type HistoryItem = Y.UndoManager["undoStack"][number];

/** Only the binding owns this origin, so editors sharing one Y.Doc still undo independently. */
class CollaborationBinding {
  private readonly undoManager: Y.UndoManager;
  private readonly selectionKey = Symbol("selection-before-edit");
  private selectionBefore: RelativeSelection | null = null;
  private captureHistory = true;

  constructor(
    private readonly view: EditorView,
    private readonly text: Y.Text,
    captureTimeout: number,
  ) {
    this.undoManager = new Y.UndoManager(text, {
      trackedOrigins: new Set([this]),
      captureTimeout,
      captureTransaction: () => this.captureHistory,
    });
    text.observe(this.receive);
    this.undoManager.on("stack-item-added", this.rememberSelection);
    this.undoManager.on("stack-item-popped", this.restoreSelection);
  }

  private readonly receive = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
    if (transaction.origin === this) return;
    const changes: ChangeSpec[] = [];
    let from = 0;
    for (const operation of event.delta) {
      if (operation.retain !== undefined) from += operation.retain;
      if (operation.delete !== undefined) {
        changes.push({ from, to: from + operation.delete });
        from += operation.delete;
      }
      if (operation.insert !== undefined) {
        if (typeof operation.insert !== "string") {
          throw new TypeError("Collaborative Markdown requires a plain-text Y.Text");
        }
        changes.push({ from, insert: Text.of(operation.insert.split("\n")) });
      }
    }
    if (changes.length === 0) return;
    this.view.dispatch({
      changes,
      filter: false,
      annotations: [
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
        editorTransactionOrigin.of(["collaboration:remote"]),
      ],
    });
  };

  update(update: ViewUpdate): void {
    if (!update.docChanged || update.transactions.every((tr) => tr.annotation(Transaction.remote))) return;
    this.selectionBefore = captureSelection(this.text, update.startState.selection);
    this.captureHistory = update.transactions.some((tr) => tr.annotation(Transaction.addToHistory) !== false);
    if (!this.captureHistory) this.undoManager.stopCapturing();
    try {
      this.text.doc!.transact(() => {
        let offset = 0;
        update.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
          if (to > from) this.text.delete(from + offset, to - from);
          if (inserted.length > 0) this.text.insert(from + offset, inserted.toString());
          offset += inserted.length - (to - from);
        });
      }, this);
    } finally {
      this.selectionBefore = null;
      this.captureHistory = true;
    }
  }

  private readonly rememberSelection = ({ stackItem }: { stackItem: HistoryItem }): void => {
    // A grouped undo should restore the selection before the first edit in that group.
    if (this.selectionBefore && !stackItem.meta.has(this.selectionKey)) {
      stackItem.meta.set(this.selectionKey, this.selectionBefore);
    }
  };

  private readonly restoreSelection = ({ stackItem }: { stackItem: HistoryItem }): void => {
    const relative = stackItem.meta.get(this.selectionKey) as RelativeSelection | undefined;
    const selection = relative && restoreSelection(this.text, relative);
    if (selection) this.view.dispatch({ selection, scrollIntoView: true });
  };

  undo(): boolean {
    return this.runHistory("undo");
  }

  redo(): boolean {
    return this.runHistory("redo");
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  private runHistory(action: "undo" | "redo"): boolean {
    if (this.view.state.readOnly) return false;
    this.selectionBefore = captureSelection(this.text, this.view.state.selection);
    try {
      return this.undoManager[action]() !== null;
    } finally {
      this.selectionBefore = null;
    }
  }

  destroy(): void {
    this.text.unobserve(this.receive);
    this.undoManager.off("stack-item-added", this.rememberSelection);
    this.undoManager.off("stack-item-popped", this.restoreSelection);
    this.undoManager.destroy();
  }
}

export function createBinding(text: Y.Text, captureTimeout: number): {
  readonly extension: Extension;
  stopCapturing(): void;
} {
  let binding: CollaborationBinding | null = null;
  const plugin = ViewPlugin.define((view) => {
    binding = new CollaborationBinding(view, text, captureTimeout);
    return binding;
  });
  const undo = (view: EditorView): boolean => view.plugin(plugin)?.undo() ?? false;
  const redo = (view: EditorView): boolean => view.plugin(plugin)?.redo() ?? false;
  const validate = StateField.define<null>({
    create(state) {
      if (state.field(historyField, false)) {
        throw new Error("Collaboration replaces plugin-history; remove the local history extension");
      }
      if (state.doc.toString() !== text.toString()) {
        throw new Error("The editor and collaborative document must start with identical text");
      }
      return null;
    },
    update: (value) => value,
  });

  return {
    extension: [
      validate,
      // Preserve CR characters as data; implicit CRLF normalization changes CRDT offsets.
      EditorState.lineSeparator.of("\n"),
      unicodeTransactions(),
      plugin,
      editorHistory.of({ undo, redo }),
      Prec.highest(keymap.of([
        { key: "Mod-z", run: (view) => { undo(view); return true; } },
        { key: "Mod-Shift-z", run: (view) => { redo(view); return true; } },
        { key: "Mod-y", run: (view) => { redo(view); return true; } },
      ])),
      EditorView.domEventHandlers({
        beforeinput(event, view) {
          if (event.inputType === "historyUndo") { undo(view); return true; }
          if (event.inputType === "historyRedo") { redo(view); return true; }
          return false;
        },
      }),
    ],
    stopCapturing: () => binding?.stopCapturing(),
  };
}
