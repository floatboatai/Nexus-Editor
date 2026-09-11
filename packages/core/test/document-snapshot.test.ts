import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { Paragraph, Root } from "mdast";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createEditor } from "../src/editor";
import { waitForSnapshotInput } from "../src/document-snapshot";
import { markdownTransformSnapshotExtension } from "../src/markdown-contributions";
import type { EditorAPI, EditorConfig } from "../src/types";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup(markdown = "# Initial", table = false, config: Partial<Omit<EditorConfig, "container">> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    initialValue: markdown,
    parseDelayMs: 150,
    onChange,
    livePreview: table,
    plugins: [createGfmPreset()],
    ...config,
  });
  editors.push(editor);
  const root = container.querySelector<HTMLElement>(".cm-editor");
  if (!root) throw new Error("Missing editor DOM");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("Missing editor view");
  return { editor, container, view, onChange };
}

function editCell(container: HTMLElement) {
  const cells = container.querySelectorAll<HTMLElement>(".nexus-cell");
  const cell = cells[cells.length - 1];
  if (!cell) throw new Error("Missing table cell");
  cell.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }),
  );
  // jsdom does not make a contentEditable property assignment focusable like Chromium.
  cell.tabIndex = -1;
  cell.focus();
  return cell;
}

describe("captureDocumentSnapshot", () => {
  it("reads immediate input without flushing onChange, changing selection, or parsing by default", async () => {
    const { editor, view, onChange } = setup();
    view.dispatch({
      changes: { from: 2, to: 9, insert: "Latest" },
      selection: { anchor: 4 },
    });
    const snapshot = await editor.captureDocumentSnapshot();
    expect(snapshot).toEqual({ markdown: "# Latest", revision: editor.getDocumentRevision?.() });
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("creates a detached AST only on request and uses installed transforms", async () => {
    const { editor, view } = setup();
    view.dispatch({ effects: [] });
    const registration = editor.getContributionSink().registerExtension(
      "snapshot-test",
      markdownTransformSnapshotExtension({
        registryId: "snapshot-test",
        version: 1,
        transform(tree) {
          tree.children.push({
            type: "paragraph",
            children: [{ type: "text", value: "transformed" }],
          });
          return tree;
        },
      }),
    );
    await registration.ready;
    const snapshot = await editor.captureDocumentSnapshot({
      includeRenderAst: true,
    });
    expect(snapshot.renderAst?.children).toHaveLength(2);
    editor.setDocument("# Later");
    expect(snapshot.markdown).toBe("# Initial");
    expect(snapshot.renderAst?.children[0]).toMatchObject({
      type: "heading",
      children: [{ value: "Initial" }],
    });
  });

  it("isolates a shared remark root from the editor cache and other snapshots", async () => {
    const shared: Root = {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "Shared" }] }],
    };
    const { editor } = setup("# Initial", false, {
      plugins: [{ name: "shared-root", remarkPlugins: [() => () => shared] }],
    });
    expect(editor.getAst()).toBe(shared);
    const first = await editor.captureDocumentSnapshot({ includeRenderAst: true });
    const second = await editor.captureDocumentSnapshot({ includeRenderAst: true });
    if (!first.renderAst) throw new Error("Missing rendering AST");
    first.renderAst.children.length = 0;
    expect(shared.children).toHaveLength(1);
    expect(editor.getAst().children).toHaveLength(1);
    expect(second.renderAst?.children).toHaveLength(1);
  });

  it("isolates shared child nodes returned by a dynamic transform", async () => {
    const shared: Paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: "Shared child" }],
    };
    const { editor } = setup();
    const registration = editor.getContributionSink().registerExtension(
      "shared-child",
      markdownTransformSnapshotExtension({
        registryId: "shared-child",
        version: 1,
        transform(tree) {
          tree.children.push(shared);
          return tree;
        },
      }),
    );
    await registration.ready;
    const first = await editor.captureDocumentSnapshot({ includeRenderAst: true });
    const second = await editor.captureDocumentSnapshot({ includeRenderAst: true });
    const paragraph = first.renderAst?.children[1];
    const text = paragraph?.type === "paragraph" ? paragraph.children[0] : null;
    if (text?.type !== "text") throw new Error("Missing transformed text");
    text.value = "Snapshot edit";
    expect(shared.children[0]).toMatchObject({ value: "Shared child" });
    expect(editor.getAst().children[1]).toMatchObject(shared);
    expect(second.renderAst?.children[1]).toMatchObject(shared);
  });

  it("rejects uncloneable rendering data while source-only capture skips transforms", async () => {
    const transform = vi.fn((tree: Root) => {
      const data: NonNullable<Root["data"]> & { callback: () => void } = {
        callback: () => undefined,
      };
      tree.data = data;
      return tree;
    });
    const { editor } = setup("# Initial", false, {
      plugins: [{ name: "uncloneable-data", remarkPlugins: [() => transform] }],
    });
    transform.mockClear();
    await expect(editor.captureDocumentSnapshot()).resolves.toEqual({ markdown: "# Initial", revision: editor.getDocumentRevision?.() });
    expect(transform).not.toHaveBeenCalled();
    await expect(editor.captureDocumentSnapshot({ includeRenderAst: true })).rejects.toMatchObject({
      name: "DataCloneError",
    });
    expect(transform).toHaveBeenCalledOnce();
    expect(editor.getDocument()).toBe("# Initial");
    await expect(editor.captureDocumentSnapshot()).resolves.toEqual({ markdown: "# Initial", revision: editor.getDocumentRevision?.() });
    expect(transform).toHaveBeenCalledOnce();
  });

  it("passes the captured Markdown to remark transforms as their file source", async () => {
    const sources: string[] = [];
    const original = "| A | B |\n| --- | --- |\n| 1 | old |";
    const { editor, container } = setup(original, true, {
      plugins: [createGfmPreset(), {
        name: "source-aware",
        remarkPlugins: [() => (tree, file) => {
          sources.push(file.toString());
          return tree;
        }],
      }],
    });
    sources.length = 0;
    const cell = editCell(container);
    cell.textContent = "pending 中文";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    const snapshot = await editor.captureDocumentSnapshot({ includeRenderAst: true });

    expect(snapshot.markdown).toContain("| 1 | pending 中文 |");
    expect(sources).toEqual([snapshot.markdown]);
    expect(editor.getDocument()).toBe(original);
  });

  it("uses the remark rendering pipeline rather than the custom document parser", async () => {
    const customTree: Root = { type: "root", children: [] };
    const parse = vi.fn(() => customTree);
    const { editor } = setup("# Initial", false, { parser: { parse } });
    expect(editor.getAst()).toBe(customTree);
    parse.mockClear();
    const snapshot = await editor.captureDocumentSnapshot({ includeRenderAst: true });
    expect(snapshot.renderAst?.children[0]).toMatchObject({ type: "heading" });
    expect(parse).not.toHaveBeenCalled();
    expect(editor.getAst()).toBe(customTree);
  });

  it("overlays repeated table edits without consuming dirty rows, transactions, or focus", async () => {
    const original = "| A | B |\n| --- | --- |\n| 1 | old |";
    const { editor, container, onChange } = setup(original, true);
    const cell = editCell(container);
    const selection = editor.getSelection();
    for (const value of ["first", "second", "最后"]) {
      cell.textContent = value;
      cell.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" }),
      );
      const snapshot = await editor.captureDocumentSnapshot();
      expect(snapshot.markdown).toContain(`| 1 | ${value} |`);
      expect(editor.getDocument()).toBe(original);
      expect(editor.getSelection()).toEqual(selection);
      expect(document.activeElement).toBe(cell);
      expect(cell.isConnected).toBe(true);
    }
    expect(onChange).not.toHaveBeenCalled();
    cell.blur();
    await Promise.resolve();
    expect(editor.getDocument()).toContain("| 1 | 最后 |");
  });

  it("keeps table blur and undo behavior unchanged after repeated snapshots", async () => {
    const original = "| A | B |\n| --- | --- |\n| 1 | old |";
    const { editor, container } = setup(original, true, {
      plugins: [createGfmPreset(), createHistoryPlugin()],
    });
    const cell = editCell(container);
    cell.textContent = "pending";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await editor.captureDocumentSnapshot();
    await editor.captureDocumentSnapshot();
    expect(editor.undo()).toBe(false);
    expect(document.activeElement).toBe(cell);
    cell.blur();
    await Promise.resolve();
    expect(editor.getDocument()).toContain("| 1 | pending |");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toContain("| 1 | pending |");
  });

  it("waits for isolated table composition and preserves its final candidate", async () => {
    const { editor, container } = setup(
      "| A | B |\n| --- | --- |\n| 1 | old |",
      true,
    );
    const cell = editCell(container);
    cell.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const resolved = vi.fn();
    const pending = editor.captureDocumentSnapshot().then((snapshot) => {
      resolved();
      return snapshot;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(resolved).not.toHaveBeenCalled();
    cell.textContent = "中";
    cell.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    cell.textContent = "中文";
    cell.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
    expect((await pending).markdown).toContain("| 1 | 中文 |");
    expect(document.activeElement).toBe(cell);
  });

  it("waits for a table mouse gesture without ending its selection", async () => {
    const { editor, container } = setup(
      "| A | B |\n| --- | --- |\n| 1 | old |",
      true,
    );
    const cell = container.querySelector<HTMLElement>(".nexus-cell");
    if (!cell) throw new Error("Missing cell");
    cell.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    const resolved = vi.fn();
    const pending = editor.captureDocumentSnapshot().then(resolved);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(resolved).not.toHaveBeenCalled();
    document.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, button: 0 }),
    );
    await pending;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it("cancels waiting for composition when aborted or destroyed", async () => {
    const { editor, view } = setup();
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const controller = new AbortController();
    const cancelled = editor.captureDocumentSnapshot({
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const destroyed = editor.captureDocumentSnapshot();
    editor.destroy();
    await expect(destroyed).rejects.toMatchObject({ name: "AbortError" });
    await expect(editor.captureDocumentSnapshot()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects an already-aborted capture without reading or changing the document", async () => {
    const { editor } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(editor.captureDocumentSnapshot({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(editor.getDocument()).toBe("# Initial");
    await expect(editor.captureDocumentSnapshot()).resolves.toEqual({ markdown: "# Initial", revision: editor.getDocumentRevision?.() });
  });

  it("reports a conflicting table range without silently consuming subsequent snapshots", async () => {
    const original = "| A | B |\n| --- | --- |\n| 1 | old |";
    const { editor, container, view } = setup(original, true);
    const cell = editCell(container);
    cell.textContent = "pending";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    view.dispatch({
      changes: {
        from: original.indexOf("old"),
        to: original.indexOf("old") + 3,
        insert: "other",
      },
    });
    await expect(editor.captureDocumentSnapshot()).rejects.toThrow(
      "no longer matches",
    );
    await expect(editor.captureDocumentSnapshot()).rejects.toThrow(
      "no longer matches",
    );
  });
});

describe("snapshot input-wait cleanup", () => {
  it.each(["settled", "aborted", "destroyed"] as const)("releases timers and listeners when %s", async (outcome) => {
    const { view } = setup();
    const lifetime = new AbortController();
    const controller = new AbortController();
    const removeLifetime = vi.spyOn(lifetime.signal, "removeEventListener");
    const removeSignal = vi.spyOn(controller.signal, "removeEventListener");
    let composing = true;
    vi.useFakeTimers();
    const pending = waitForSnapshotInput(view, () => composing, lifetime.signal, controller.signal);
    const result = outcome === "settled"
      ? expect(pending).resolves.toBeUndefined()
      : expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    if (outcome === "settled") {
      composing = false;
      await vi.advanceTimersByTimeAsync(32);
    } else if (outcome === "aborted") {
      controller.abort();
    } else {
      lifetime.abort();
    }
    await result;
    expect(vi.getTimerCount()).toBe(0);
    expect(removeLifetime).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeSignal).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
