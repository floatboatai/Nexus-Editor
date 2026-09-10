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
  it("prevents a filter from corrupting changes seen by later filters", () => {
    const { editor } = createTestEditor();
    const sink = editor.getContributionSink();
    const mutations: boolean[] = [];
    sink.registerTransactionFilter("mutator", (context) => {
      mutations.push(Reflect.set(context.changes[0], "insert", "corrupted"));
      mutations.push(Reflect.set(context.changes[0], "from", 1));
      return { action: "accept" };
    }, { priority: 10 });
    sink.registerTransactionFilter("transformer", (context) => ({
      action: "replace",
      transaction: {
        changes: context.changes.map((change) => ({
          ...change,
          insert: change.insert.toUpperCase(),
        })),
        origin: [...context.origin, "transformer"],
      },
    }));

    try {
      const result = editor.dispatchTransaction(transaction([{ from: 0, to: 1, insert: "x" }]));
      expect(mutations).toEqual([false, false]);
      expect(result.status).toBe("success");
      expect(editor.getDocument()).toBe("Xbcd");
    } finally {
      editor.destroy();
    }
  });

  it("isolates all selection ranges from mutations by update listeners", () => {
    const { editor } = createTestEditor();
    editor.setSelections([{ anchor: 1, head: 0 }, { anchor: 3, head: 4 }], 1);
    const sink = editor.getContributionSink();
    const mutations: boolean[] = [];
    const observer = vi.fn();
    sink.registerUpdateListener("mutator", (update) => {
      for (const selection of [update.selectionBefore, update.selectionAfter]) {
        for (const range of selection.ranges) {
          mutations.push(Reflect.set(range, "anchor", 2));
          mutations.push(Reflect.set(range, "head", 2));
        }
        mutations.push(Reflect.set(selection.ranges, "length", 0));
      }
      mutations.push(Reflect.set(update.changes[0], "insert", "corrupted"));
    }, { priority: 10 });
    sink.registerUpdateListener("observer", observer);

    try {
      const result = editor.dispatchTransaction(transaction([{ from: 1, to: 1, insert: "X" }]));
      expect(mutations).toEqual(Array(11).fill(false));
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0][0]).toMatchObject({
        changes: [{ from: 1, to: 1, insert: "X" }],
        selectionBefore: {
          ranges: [{ anchor: 1, head: 0 }, { anchor: 3, head: 4 }],
          mainIndex: 1,
        },
        selectionAfter: editor.getSelections(),
        documentAfter: editor.getDocument(),
      });
      expect(result).toEqual({ status: "success", update: observer.mock.calls[0][0] });
    } finally {
      editor.destroy();
    }
  });

  it("freezes replacement snapshots without freezing caller-owned transactions", () => {
    const { editor } = createTestEditor();
    const replacement: CoreEditorTransaction = {
      changes: [{ from: 0, to: 1, insert: "X" }],
      selection: { ranges: [{ anchor: 1, head: 1 }], mainIndex: 0 },
      origin: ["replacement"],
    };
    const sink = editor.getContributionSink();
    const mutations: boolean[] = [];
    sink.registerTransactionFilter("replace", () => ({ action: "replace", transaction: replacement }),
      { priority: 10 });
    sink.registerTransactionFilter("observer", (context) => {
      mutations.push(Reflect.set(context.changes[0], "insert", "corrupted"));
      mutations.push(Reflect.set(context.selectionAfter.ranges[0], "head", 0));
      mutations.push(Reflect.set(context.selectionBefore.ranges, "length", 0));
      return { action: "accept" };
    });

    try {
      editor.dispatchTransaction(transaction([{ from: 0, to: 0, insert: "ignored" }]));
      expect(mutations).toEqual([false, false, false]);
      expect(editor.getDocument()).toBe("Xbcd");
      expect(editor.getSelections()).toEqual(replacement.selection);
      expect(Reflect.set(replacement.changes[0], "insert", "reusable")).toBe(true);
      expect(Reflect.set(replacement.selection!.ranges[0], "head", 0)).toBe(true);
      expect(Reflect.set(replacement.origin, "length", 0)).toBe(true);
      expect(editor.getDocument()).toBe("Xbcd");
      expect(editor.getSelection()).toMatchObject({ anchor: 1, head: 1 });
    } finally {
      editor.destroy();
    }
  });

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
});
