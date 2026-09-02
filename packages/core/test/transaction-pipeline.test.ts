import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";

import {
  EDITOR_TRANSACTION_RECURSION_LIMIT,
  createEditor,
  editorTransactionOrigin,
  type CoreEditorTransaction,
  type CoreEditorTransactionContext,
  type CoreEditorUpdateContext,
} from "../src";

function createTestEditor(initialValue = "abcd", multiCursor = true) {
  const container = document.createElement("div");
  let view: EditorView | null = null;
  const editor = createEditor({
    container,
    initialValue,
    multiCursor,
    plugins: [{
      name: "capture-view",
      cmExtensions: [ViewPlugin.fromClass(class {
        constructor(current: EditorView) {
          view = current;
        }
      })],
    }],
  });
  if (!view) throw new Error("Expected EditorView to be captured");
  return { editor, view: view as EditorView };
}

function transaction(
  changes: CoreEditorTransaction["changes"],
  origin: readonly string[] = ["test"]
): CoreEditorTransaction {
  return { changes, origin };
}

describe("core editor transaction pipeline", () => {
  it("filters before commit and only notifies listeners with the final update", () => {
    const { editor } = createTestEditor();
    const sink = editor.getContributionSink();
    const filters: string[] = [];
    const updates: CoreEditorUpdateContext[] = [];

    sink.registerTransactionFilter("late", (context) => {
      filters.push(`late:${context.editor.getDocument()}:${context.changes[0]?.insert}`);
      return { action: "accept" };
    }, { priority: 0 });
    sink.registerTransactionFilter("early", (context) => {
      filters.push(`early:${context.editor.getDocument()}:${context.changes[0]?.insert}`);
      return {
        action: "replace",
        transaction: {
          changes: [{ from: 1, to: 3, insert: "XY" }],
          selection: {
            ranges: [{ anchor: 1, head: 3 }],
            mainIndex: 0,
          },
          origin: ["early"],
        },
      };
    }, { priority: 10 });
    sink.registerUpdateListener("observer", (update) => updates.push(update));

    const result = editor.dispatchTransaction(transaction([{ from: 0, to: 1, insert: "Q" }], ["user"]));

    expect(result.status).toBe("success");
    expect(filters).toEqual(["early:abcd:Q", "late:abcd:XY"]);
    expect(editor.getDocument()).toBe("aXYd");
    expect(editor.getSelections()).toEqual({ ranges: [{ anchor: 1, head: 3 }], mainIndex: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      changes: [{ from: 1, to: 3, insert: "XY" }],
      selectionBefore: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0 },
      selectionAfter: { ranges: [{ anchor: 1, head: 3 }], mainIndex: 0 },
      origin: ["user", "early"],
      documentBefore: "abcd",
      documentAfter: "aXYd",
    });
    editor.destroy();
  });

  it("rejects without changing the document or notifying update listeners", () => {
    const { editor } = createTestEditor();
    const listener = vi.fn();
    editor.getContributionSink().registerTransactionFilter("guard", () => ({
      action: "reject",
      reason: "read-only-section",
    }));
    editor.getContributionSink().registerUpdateListener("observer", listener);

    const result = editor.dispatchTransaction(transaction([{ from: 0, to: 0, insert: "x" }]));

    expect(result).toEqual({ status: "rejected", ownerId: "guard", reason: "read-only-section" });
    expect(editor.getDocument()).toBe("abcd");
    expect(listener).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("keeps multiple changes, multi-selection, userEvent, and native origin annotations", () => {
    const { editor, view } = createTestEditor("abcdef");
    const filter = vi.fn((_context: CoreEditorTransactionContext) => ({ action: "accept" as const }));
    const listener = vi.fn();
    editor.getContributionSink().registerTransactionFilter("filter", filter);
    editor.getContributionSink().registerUpdateListener("listener", listener);

    view.dispatch({
      changes: [
        { from: 0, to: 1, insert: "A" },
        { from: 5, to: 6, insert: "F" },
      ],
      selection: EditorSelection.create([
        EditorSelection.range(1, 2),
        EditorSelection.cursor(5),
      ], 1),
      annotations: editorTransactionOrigin.of(["native", "spellcheck"]),
      userEvent: "input.type",
    });

    expect(filter).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      changes: [
        { from: 0, to: 1, insert: "A" },
        { from: 5, to: 6, insert: "F" },
      ],
      selectionAfter: {
        ranges: [{ anchor: 1, head: 2 }, { anchor: 5, head: 5 }],
        mainIndex: 1,
      },
      origin: ["native", "spellcheck"],
      userEvent: "input.type",
    });
    editor.destroy();
  });

  it("merges a sequential batch into one atomic CM6 transaction and one undo entry", () => {
    const container = document.createElement("div");
    const listener = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [{
        name: "history",
        cmExtensions: [history()],
      }],
    });
    editor.getContributionSink().registerUpdateListener("listener", listener);

    const result = editor.dispatchTransactions([
      transaction([{ from: 1, to: 1, insert: "X" }], ["batch"]),
      transaction([{ from: 2, to: 2, insert: "Y" }], ["second"]),
    ]);

    expect(result.status).toBe("success");
    expect(editor.getDocument()).toBe("aXYb");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].origin).toEqual(["batch", "second"]);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("allows listeners to identify their own follow-up origin", () => {
    const { editor } = createTestEditor("");
    const seen: string[][] = [];
    editor.getContributionSink().registerUpdateListener("formatter", (update) => {
      seen.push([...update.origin]);
      if (!update.origin.includes("formatter")) {
        editor.dispatchTransaction(transaction(
          [{ from: editor.getDocument().length, to: editor.getDocument().length, insert: "!" }],
          [...update.origin, "formatter"]
        ));
      }
    });

    editor.dispatchTransaction(transaction([{ from: 0, to: 0, insert: "a" }], ["user"]));

    expect(seen).toEqual([["user"], ["user", "formatter"]]);
    expect(editor.getDocument()).toBe("a!");
    editor.destroy();
  });

  it("stops unbounded synchronous listener recursion with a diagnostic result", () => {
    const { editor } = createTestEditor("");
    let calls = 0;
    let stopped: ReturnType<typeof editor.dispatchTransaction> | undefined;
    editor.getContributionSink().registerUpdateListener("recursive", () => {
      calls += 1;
      const end = editor.getDocument().length;
      const result = editor.dispatchTransaction(transaction([{ from: end, to: end, insert: "x" }], ["recursive"]));
      if (result.status === "recursion-limit") stopped = result;
    });

    editor.dispatchTransaction(transaction([{ from: 0, to: 0, insert: "x" }], ["start"]));

    expect(stopped).toEqual({ status: "recursion-limit", limit: EDITOR_TRANSACTION_RECURSION_LIMIT });
    expect(calls).toBe(EDITOR_TRANSACTION_RECURSION_LIMIT);
    expect(editor.getDocument()).toHaveLength(EDITOR_TRANSACTION_RECURSION_LIMIT);
    editor.destroy();
  });

  it("uses stable priority/order snapshots and idempotent owner-bound disposal", async () => {
    const { editor } = createTestEditor("");
    const sink = editor.getContributionSink();
    const calls: string[] = [];
    let second = sink.registerTransactionFilter("second", () => {
      calls.push("second");
      return { action: "accept" };
    }, { priority: 1 });
    sink.registerTransactionFilter("first", () => {
      calls.push("first");
      void second.dispose();
      return { action: "accept" };
    }, { priority: 1 });
    await second.dispose();
    await second.dispose();
    second = sink.registerTransactionFilter("second", () => {
      calls.push("second");
      return { action: "accept" };
    }, { priority: 1 });

    editor.dispatchTransaction(transaction([{ from: 0, to: 0, insert: "a" }]));

    expect(calls).toEqual(["first"]);
    expect(second.disposed).toBe(true);
    editor.destroy();
  });

  it("registers one authoritative source and bypasses proposal filters", async () => {
    const { editor } = createTestEditor("abcd");
    const filter = vi.fn(() => ({ action: "reject" as const, reason: "local-policy" }));
    const listener = vi.fn();
    const sink = editor.getContributionSink();
    sink.registerTransactionFilter("guard", filter);
    sink.registerUpdateListener("observer", listener);

    const source = sink.registerAuthoritativeSource("collab", {
      undo: () => false,
      redo: () => false,
    });
    await source.ready;

    const result = source.dispatch(transaction(
      [{ from: 1, to: 3, insert: "XY" }],
      ["remote-yjs"],
    ));

    expect(result.status).toBe("success");
    expect(filter).not.toHaveBeenCalled();
    expect(editor.getDocument()).toBe("aXYd");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      authority: "authoritative",
      sourceOwnerId: "collab",
      origin: ["remote-yjs"],
      documentBefore: "abcd",
      documentAfter: "aXYd",
    });
    editor.destroy();
  });

  it("keeps ordinary dispatches as filterable local proposals", () => {
    const { editor } = createTestEditor("abcd");
    const listener = vi.fn();
    editor.getContributionSink().registerUpdateListener("observer", listener);

    const result = editor.dispatchTransaction(transaction(
      [{ from: 0, to: 1, insert: "A" }],
      ["user"],
    ));

    expect(result.status).toBe("success");
    expect(listener.mock.calls[0][0]).toMatchObject({
      authority: "proposal",
      sourceOwnerId: undefined,
    });
    editor.destroy();
  });

  it("rejects a competing source without disturbing the active owner", async () => {
    const { editor } = createTestEditor("abcd");
    const sink = editor.getContributionSink();
    const first = sink.registerAuthoritativeSource("first", {
      undo: () => false,
      redo: () => false,
    });
    await first.ready;

    expect(() => sink.registerAuthoritativeSource("second", {
      undo: () => false,
      redo: () => false,
    })).toThrow(/first/);

    expect(first.dispatch(transaction([{ from: 0, to: 1, insert: "A" }])).status).toBe("success");
    expect(editor.getDocument()).toBe("Abcd");
    editor.destroy();
  });

  it("routes EditorAPI history to the active source and restores defaults after disposal", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [{ name: "history", cmExtensions: [history()] }],
    });
    const undo = vi.fn(() => false);
    const redo = vi.fn(() => true);
    const source = editor.getContributionSink().registerAuthoritativeSource("collab", { undo, redo });
    await source.ready;

    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);

    editor.dispatchTransaction(transaction([{ from: 1, to: 1, insert: "C" }], ["collab-local"]));
    source.dispatch(transaction([{ from: 2, to: 2, insert: "R" }], ["collab-remote"]));
    await source.dispose();
    expect(editor.undo()).toBe(false);
    editor.dispatchTransaction(transaction([{ from: 3, to: 3, insert: "X" }]));
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("aCRb");
    editor.destroy();
  });

  it("routes keymap and beforeinput history without falling through while a source is active", async () => {
    const container = document.createElement("div");
    let view: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [{
        name: "history-and-view",
        cmExtensions: [
          history(),
          ViewPlugin.fromClass(class {
            constructor(current: EditorView) {
              view = current;
            }
          }),
        ],
      }],
    });
    if (!view) throw new Error("Expected EditorView to be captured");
    const activeView = view as EditorView;
    editor.dispatchTransaction(transaction([{ from: 1, to: 1, insert: "X" }]));
    const undo = vi.fn(() => false);
    const redo = vi.fn(() => false);
    const source = editor.getContributionSink().registerAuthoritativeSource("collab", { undo, redo });
    await source.ready;

    const keyEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    activeView.contentDOM.dispatchEvent(keyEvent);
    expect(keyEvent.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(editor.getDocument()).toBe("aXb");

    const inputEvent = new InputEvent("beforeinput", {
      inputType: "historyRedo",
      bubbles: true,
      cancelable: true,
    });
    activeView.contentDOM.dispatchEvent(inputEvent);
    expect(inputEvent.defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(editor.getDocument()).toBe("aXb");

    await source.dispose();
    const fallbackKey = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    activeView.contentDOM.dispatchEvent(fallbackKey);
    expect(editor.getDocument()).toBe("ab");
    editor.destroy();
  });

  it("invalidates source dispatch after disposal and Editor destruction", async () => {
    const { editor } = createTestEditor("ab");
    const source = editor.getContributionSink().registerAuthoritativeSource("collab", {
      undo: () => false,
      redo: () => false,
    });
    await source.dispose();
    expect(source.dispatch(transaction([{ from: 0, to: 0, insert: "x" }]))).toEqual({
      status: "rejected",
      ownerId: "collab",
      reason: "source-disposed",
    });

    const second = editor.getContributionSink().registerAuthoritativeSource("second", {
      undo: () => false,
      redo: () => false,
    });
    await second.ready;
    editor.destroy();
    expect(second.disposed).toBe(true);
    expect(second.dispatch(transaction([{ from: 0, to: 0, insert: "x" }]))).toEqual({
      status: "rejected",
      ownerId: "second",
      reason: "editor-destroyed",
    });
  });

  it("commits an authoritative batch atomically and isolates listener failures", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "ab", onChange });
    const observed: CoreEditorUpdateContext[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    editor.getContributionSink().registerUpdateListener("broken", () => {
      throw new Error("injected listener failure");
    }, { priority: 10 });
    editor.getContributionSink().registerUpdateListener("healthy", (update) => observed.push(update));
    const source = editor.getContributionSink().registerAuthoritativeSource("collab", {
      undo: () => false,
      redo: () => false,
    });

    const result = source.dispatchTransactions([
      transaction([{ from: 1, to: 1, insert: "X" }], ["remote"]),
      {
        changes: [{ from: 2, to: 2, insert: "Y" }],
        selection: { ranges: [{ anchor: 3, head: 3 }], mainIndex: 0 },
        origin: ["batch"],
      },
    ]);

    expect(result.status).toBe("success");
    expect(editor.getDocument()).toBe("aXYb");
    expect(editor.getSelections()).toEqual({ ranges: [{ anchor: 3, head: 3 }], mainIndex: 0 });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      authority: "authoritative",
      sourceOwnerId: "collab",
      origin: ["remote", "batch"],
      documentBefore: "ab",
      documentAfter: "aXYb",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    editor.destroy();
  });

  it("bounds authoritative listener recursion and returns a structured apply failure", () => {
    const { editor } = createTestEditor("");
    let source: ReturnType<ReturnType<typeof editor.getContributionSink>["registerAuthoritativeSource"]>;
    let stopped: ReturnType<typeof source.dispatch> | undefined;
    editor.getContributionSink().registerUpdateListener("recursive-authority", (update) => {
      if (update.authority !== "authoritative") return;
      const end = editor.getDocument().length;
      const result = source.dispatch(transaction([{ from: end, to: end, insert: "x" }], ["recursive"]));
      if (result.status === "recursion-limit") stopped = result;
    });
    source = editor.getContributionSink().registerAuthoritativeSource("collab", {
      undo: () => false,
      redo: () => false,
    });

    source.dispatch(transaction([{ from: 0, to: 0, insert: "x" }], ["start"]));
    expect(stopped).toEqual({ status: "recursion-limit", limit: EDITOR_TRANSACTION_RECURSION_LIMIT });
    expect(editor.getDocument()).toHaveLength(EDITOR_TRANSACTION_RECURSION_LIMIT);

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = source.dispatch(transaction([{ from: 99, to: 99, insert: "bad" }]));
    expect(failed).toEqual({
      status: "rejected",
      ownerId: "collab",
      reason: "authoritative-apply-failed",
    });
    expect(error).toHaveBeenCalled();
    editor.destroy();
  });
});
