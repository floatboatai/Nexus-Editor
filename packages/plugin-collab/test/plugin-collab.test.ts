import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  createEditor,
  editorTransactionOrigin,
  type EditorAPI,
  type NexusPlugin,
} from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  COLLABORATION_AWARENESS_FIELD,
  COLLABORATION_REMOTE_ORIGIN,
  createCollaborationPlugin,
  getCollaborationBindingStatus,
  seedCollaborationDocument,
} from "../src/index";

const editors: EditorAPI[] = [];
const awarenessInstances: Awareness[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const awareness of awarenessInstances.splice(0)) awareness.destroy();
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function cloneUpdate(update: Uint8Array): Uint8Array {
  return new Uint8Array(update);
}

class ImmediateUpdatePair {
  readonly deliveries: Array<{ from: "a" | "b"; update: Uint8Array }> = [];
  private readonly origin = Object.freeze({ provider: "immediate-test" });

  constructor(readonly a: Y.Doc, readonly b: Y.Doc) {
    a.on("update", this.fromA);
    b.on("update", this.fromB);
  }

  destroy(): void {
    this.a.off("update", this.fromA);
    this.b.off("update", this.fromB);
  }

  private readonly fromA = (update: Uint8Array, origin: unknown): void => {
    if (origin === this.origin) return;
    this.deliveries.push({ from: "a", update: cloneUpdate(update) });
    Y.applyUpdate(this.b, update, this.origin);
  };

  private readonly fromB = (update: Uint8Array, origin: unknown): void => {
    if (origin === this.origin) return;
    this.deliveries.push({ from: "b", update: cloneUpdate(update) });
    Y.applyUpdate(this.a, update, this.origin);
  };
}

class BufferedUpdatePair {
  readonly queue: Array<{ target: Y.Doc; update: Uint8Array }> = [];
  connected = true;
  private readonly origin = Object.freeze({ provider: "buffered-test" });

  constructor(readonly a: Y.Doc, readonly b: Y.Doc) {
    a.on("update", this.fromA);
    b.on("update", this.fromB);
  }

  disconnect(): void {
    this.connected = false;
  }

  reconnect(): void {
    this.connected = true;
  }

  flush(options: { reverse?: boolean; duplicate?: boolean } = {}): void {
    if (!this.connected) return;
    const pending = this.queue.splice(0);
    if (options.reverse) pending.reverse();
    for (const message of pending) {
      Y.applyUpdate(message.target, message.update, this.origin);
      if (options.duplicate) Y.applyUpdate(message.target, message.update, this.origin);
    }
  }

  destroy(): void {
    this.a.off("update", this.fromA);
    this.b.off("update", this.fromB);
  }

  private readonly fromA = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this.origin) this.queue.push({ target: this.b, update: cloneUpdate(update) });
  };

  private readonly fromB = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this.origin) this.queue.push({ target: this.a, update: cloneUpdate(update) });
  };
}

interface EditorFixture {
  readonly editor: EditorAPI;
  readonly view: EditorView;
  readonly origins: Array<readonly string[]>;
  readonly remoteChanges: Array<Array<{ from: number; to: number; insert: string }>>;
  readonly container: HTMLElement;
}

function collaborativeEditor(
  doc: Y.Doc,
  options: {
    initialValue?: string;
    awareness?: Awareness;
    user?: { id: string; name: string; color: string };
    captureTimeout?: number;
    extraPlugins?: NexusPlugin[];
  } = {},
): EditorFixture {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let view: EditorView | null = null;
  const origins: Array<readonly string[]> = [];
  const remoteChanges: Array<Array<{ from: number; to: number; insert: string }>> = [];
  const capture: NexusPlugin = {
    name: `capture-${doc.clientID}`,
    cmExtensions: [
      ViewPlugin.fromClass(class {
        constructor(current: EditorView) {
          view = current;
        }
      }),
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions) {
          const value = transaction.annotation(editorTransactionOrigin);
          if (value) origins.push(value);
          if (value?.includes(COLLABORATION_REMOTE_ORIGIN)) {
            const changes: Array<{ from: number; to: number; insert: string }> = [];
            transaction.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
              changes.push({ from, to, insert: inserted.toString() });
            });
            remoteChanges.push(changes);
          }
        }
      }),
    ],
  };
  const editor = createEditor({
    container,
    initialValue: options.initialValue ?? "local placeholder",
    parseDelayMs: 0,
    plugins: [
      capture,
      ...(options.extraPlugins ?? []),
      createCollaborationPlugin({
        doc,
        awareness: options.awareness,
        user: options.user,
        captureTimeout: options.captureTimeout ?? 0,
      }),
    ],
  });
  editors.push(editor);
  if (!view) throw new Error("Expected the collaboration test to capture EditorView");
  return { editor, view: view as EditorView, origins, remoteChanges, container };
}

function pressUndo(container: HTMLElement): void {
  container.querySelector("[contenteditable='true']")?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function connectAwareness(left: Awareness, right: Awareness): () => void {
  const origin = Object.freeze({ provider: "awareness-test" });
  const leftUpdate = ({ added, updated, removed }: {
    added: number[];
    updated: number[];
    removed: number[];
  }, updateOrigin: unknown): void => {
    if (updateOrigin === origin) return;
    applyAwarenessUpdate(right, encodeAwarenessUpdate(left, [...added, ...updated, ...removed]), origin);
  };
  const rightUpdate = ({ added, updated, removed }: {
    added: number[];
    updated: number[];
    removed: number[];
  }, updateOrigin: unknown): void => {
    if (updateOrigin === origin) return;
    applyAwarenessUpdate(left, encodeAwarenessUpdate(right, [...added, ...updated, ...removed]), origin);
  };
  left.on("update", leftUpdate);
  right.on("update", rightUpdate);
  return () => {
    left.off("update", leftUpdate);
    right.off("update", rightUpdate);
  };
}

describe("@floatboat/nexus-plugin-collab", () => {
  it("treats the shared Y.Text as authoritative and only seeds explicitly", async () => {
    const doc = new Y.Doc();
    expect(seedCollaborationDocument(doc, "# Shared\n\nHello")).toBe(true);
    expect(seedCollaborationDocument(doc, "must not overwrite")).toBe(false);

    const fixture = collaborativeEditor(doc, { initialValue: "stale local value" });
    await settle();

    expect(fixture.editor.getDocument()).toBe("# Shared\n\nHello");
    expect(fixture.editor.getTableOfContents()).toEqual([
      expect.objectContaining({ text: "Shared" }),
    ]);

    doc.transact(() => {
      doc.getText("content").delete(2, 6);
      doc.getText("content").insert(2, "Remote");
    });
    await settle();
    expect(fixture.editor.getTableOfContents()).toEqual([
      expect.objectContaining({ text: "Remote" }),
    ]);
  });

  it("synchronizes inserts, deletes, replacements, and multiline paste through an immediate provider shape", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "alpha\nbeta");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new ImmediateUpdatePair(a, b);
    const left = collaborativeEditor(a);
    const right = collaborativeEditor(b);
    await settle();

    left.editor.replaceRange(5, 5, " one\ntwo");
    left.editor.replaceRange(0, 1, "A");
    right.editor.replaceRange(right.editor.getDocument().length - 1, right.editor.getDocument().length, "TA");
    await settle();

    expect(left.editor.getDocument()).toBe("Alpha one\ntwo\nbetTA");
    expect(right.editor.getDocument()).toBe(left.editor.getDocument());
    expect(a.getText("content").toString()).toBe(left.editor.getDocument());
    expect(b.getText("content").toString()).toBe(left.editor.getDocument());
    expect(provider.deliveries).toHaveLength(3);
    expect(right.origins.some((origins) => origins.includes(COLLABORATION_REMOTE_ORIGIN))).toBe(true);
    provider.destroy();
  });

  it("converges after disconnect with concurrent edits, reversed delivery, and duplicates", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "table\n| A | B |\n| - | - |\n| 1 | 2 |");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new BufferedUpdatePair(a, b);
    const left = collaborativeEditor(a);
    const right = collaborativeEditor(b);
    await settle();

    provider.disconnect();
    left.editor.replaceRange(0, 0, "L:");
    right.editor.replaceRange(0, 0, "R:");
    left.editor.replaceRange(left.editor.getDocument().indexOf("1"), left.editor.getDocument().indexOf("1") + 1, "10");
    right.editor.replaceRange(right.editor.getDocument().indexOf("2"), right.editor.getDocument().indexOf("2") + 1, "20");
    expect(left.editor.getDocument()).not.toBe(right.editor.getDocument());

    provider.reconnect();
    provider.flush({ reverse: true, duplicate: true });
    await settle();

    expect(left.editor.getDocument()).toBe(right.editor.getDocument());
    expect(left.editor.getDocument()).toBe(a.getText("content").toString());
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    provider.destroy();
  });

  it("uses local-only collaborative undo and preserves a peer's remote edit", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "abc");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new ImmediateUpdatePair(a, b);
    const left = collaborativeEditor(a, {
      captureTimeout: 0,
      extraPlugins: [createHistoryPlugin()],
    });
    const right = collaborativeEditor(b, { captureTimeout: 0 });
    await settle();

    left.editor.replaceRange(3, 3, "X");
    right.editor.replaceRange(4, 4, "Y");
    expect(left.editor.getDocument()).toBe("abcXY");

    pressUndo(left.container);
    await settle();

    expect(left.editor.getDocument()).toBe("abcY");
    expect(right.editor.getDocument()).toBe("abcY");
    expect(getCollaborationBindingStatus(left.view)).toMatchObject({ undoDepth: 0, redoDepth: 1 });

    // CodeMirror history must not retain a second copy of the same local edit.
    pressUndo(left.container);
    await settle();
    expect(left.editor.getDocument()).toBe("abcY");
    expect(right.editor.getDocument()).toBe("abcY");
    provider.destroy();
  });

  it("publishes relative selections and renders remote presence without trusting malformed state", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "hello");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new ImmediateUpdatePair(a, b);
    const awarenessA = new Awareness(a);
    const awarenessB = new Awareness(b);
    awarenessInstances.push(awarenessA, awarenessB);
    const disconnectAwareness = connectAwareness(awarenessA, awarenessB);
    const left = collaborativeEditor(a, {
      awareness: awarenessA,
      user: { id: "alice", name: "Alice", color: "#2563eb" },
    });
    const right = collaborativeEditor(b, {
      awareness: awarenessB,
      user: { id: "bob", name: "Bob", color: "#dc2626" },
    });
    await settle();

    left.editor.setSelection(1, 4);
    await settle();
    expect(right.container.querySelector(`[data-collaboration-client="${awarenessA.clientID}"]`)).not.toBeNull();
    expect(right.container.textContent).toContain("Alice");

    const validSelection = (awarenessA.getLocalState()?.[COLLABORATION_AWARENESS_FIELD] as {
      selection: unknown;
    }).selection;
    awarenessA.setLocalStateField(COLLABORATION_AWARENESS_FIELD, {
      user: { id: 42, name: { trim: "not a function" }, color: { unsafe: true } },
      selection: validSelection,
    });
    await settle();
    expect(right.container.querySelector(`[data-collaboration-client="${awarenessA.clientID}"]`)).not.toBeNull();

    awarenessA.setLocalStateField(COLLABORATION_AWARENESS_FIELD, {
      user: { id: "bad", name: "Malformed", color: "javascript:alert(1)" },
      selection: { anchor: "bad", head: [999, 998] },
    });
    await settle();
    expect(right.container.textContent).not.toContain("Malformed");
    disconnectAwareness();
    provider.destroy();
  });

  it("disposes observers and awareness state idempotently", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "before");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new ImmediateUpdatePair(a, b);
    const awarenessA = new Awareness(a);
    const awarenessB = new Awareness(b);
    awarenessInstances.push(awarenessA, awarenessB);
    const disconnectAwareness = connectAwareness(awarenessA, awarenessB);
    const left = collaborativeEditor(a, { awareness: awarenessA });
    collaborativeEditor(b, { awareness: awarenessB });
    await settle();

    const snapshot = left.editor.getDocument();
    left.editor.destroy();
    left.editor.destroy();
    b.getText("content").insert(b.getText("content").length, " remote");
    await settle();

    expect(left.editor.getDocument()).toBe(snapshot);
    expect(awarenessA.getLocalState()?.[COLLABORATION_AWARENESS_FIELD]).toBeNull();
    expect(getCollaborationBindingStatus(left.view)).toBeNull();
    disconnectAwareness();
    provider.destroy();
  });

  it("converges for a reproducible randomized edit stream", async () => {
    const seed = 0x5eed1234;
    let randomState = seed;
    const random = (): number => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "seed");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new BufferedUpdatePair(a, b);
    const left = collaborativeEditor(a);
    const right = collaborativeEditor(b);
    await settle();

    for (let index = 0; index < 80; index += 1) {
      const target = random() < 0.5 ? left.editor : right.editor;
      const value = target.getDocument();
      if (value.length > 0 && random() < 0.35) {
        const from = Math.floor(random() * value.length);
        const length = 1 + Math.floor(random() * Math.min(3, value.length - from));
        target.replaceRange(from, from + length, "");
      } else {
        const at = Math.floor(random() * (value.length + 1));
        target.replaceRange(at, at, String.fromCharCode(97 + (index % 26)));
      }
      if (index % 7 === 6) provider.flush({ reverse: random() < 0.5, duplicate: random() < 0.5 });
    }
    provider.flush({ reverse: true, duplicate: true });
    await settle();

    expect(left.editor.getDocument(), `failing seed: ${seed}`).toBe(right.editor.getDocument());
    expect(a.getText("content").toString(), `failing seed: ${seed}`).toBe(b.getText("content").toString());
    provider.destroy();
  });

  it("marks bootstrap and remote transactions as non-history operations", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedCollaborationDocument(a, "one");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const provider = new ImmediateUpdatePair(a, b);
    collaborativeEditor(a);
    const right = collaborativeEditor(b);
    await settle();

    a.transact(() => {
      a.getText("content").delete(1, 1);
      a.getText("content").insert(1, "XYZ");
    });
    await settle();

    expect(right.editor.getDocument()).toBe("oXYZe");
    expect(right.origins.at(-1)).toContain(COLLABORATION_REMOTE_ORIGIN);
    expect(getCollaborationBindingStatus(right.view)).toMatchObject({ undoDepth: 0, redoDepth: 0 });
    provider.destroy();
  });

  it("keeps a remote edit incremental in a 10,000-line document", async () => {
    const doc = new Y.Doc();
    const markdown = Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join("\n");
    seedCollaborationDocument(doc, markdown);
    const fixture = collaborativeEditor(doc);
    await settle();
    const at = markdown.indexOf("line 5000") + 5;

    doc.getText("content").insert(at, "REMOTE-");
    await settle();

    expect(fixture.remoteChanges.at(-1)).toEqual([{ from: at, to: at, insert: "REMOTE-" }]);
    expect(fixture.editor.getDocument().length).toBe(markdown.length + 7);
  });

  it("accepts an incremental remote update while an IME composition is active", async () => {
    const doc = new Y.Doc();
    seedCollaborationDocument(doc, "中文输入");
    const fixture = collaborativeEditor(doc);
    await settle();
    const content = fixture.container.querySelector("[contenteditable='true']");

    content?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
    doc.getText("content").insert(0, "远端：");
    content?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
    await settle();

    expect(fixture.editor.getDocument()).toBe("远端：中文输入");
    expect(doc.getText("content").toString()).toBe(fixture.editor.getDocument());
  });
});
