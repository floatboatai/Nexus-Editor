import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "../../plugin-history/src/index";
import { createGfmPreset } from "../../preset-gfm/src/index";
import { createSearchPlugin } from "../src/index";
import {
  createDocumentSearchController,
  type DocumentSearchController,
  type DocumentSearchOptions,
} from "../src/headless";
import { scanSearchDocument } from "../src/search-matcher";
import type { SearchExecutor } from "../src/workspace";

const editors: EditorAPI[] = [];
const controllers: DocumentSearchController[] = [];
afterEach(async () => {
  editors.splice(0).forEach((editor) => editor.destroy());
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
  document.body.replaceChildren();
});
function executor(): SearchExecutor {
  return { scan: async (request) => scanSearchDocument(request), dispose() {} };
}
async function setup(content = "one two one", options: {
  table?: boolean;
  readOnly?: boolean;
  multiCursor?: boolean;
  limits?: DocumentSearchOptions["limits"];
  executor?: SearchExecutor;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container, initialValue: content, readOnly: options.readOnly, multiCursor: options.multiCursor,
    livePreview: options.table,
    plugins: [createGfmPreset(), createSearchPlugin({ ui: "headless" }), createHistoryPlugin()],
  });
  editors.push(editor);
  const controller = createDocumentSearchController(editor, {
    executor: options.executor ?? executor(),
    limits: options.limits,
  });
  controllers.push(controller);
  await controller.ready;
  return { editor, controller, container };
}

describe("headless document search", () => {
  it("binds independent editors and never creates a panel for invalid queries or shortcuts", async () => {
    const a = await setup("one two one"), b = await setup("two three");
    await a.controller.setQuery({ text: "one" });
    await b.controller.setQuery({ text: "two" });
    expect(a.controller.getState().hits).toHaveLength(2);
    expect(b.controller.getState().hits).toHaveLength(1);
    await a.controller.findNext();
    expect(a.editor.getSelectedText()).toBe("one");
    expect(b.editor.getSelectedText()).toBe("");
    await a.controller.setQuery({ text: "[", regex: true });
    expect(a.controller.getState().error?.code).toBe("invalid-query");
    for (const key of ["F3", "f"]) {
      a.container.querySelector(".cm-content")?.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: key === "f", bubbles: true, cancelable: true }));
    }
    await Promise.resolve();
    expect(document.querySelector(".cm-search, .nexus-search-panel")).toBeNull();
    await a.controller.dispose();
    await b.controller.findNext();
    expect(b.editor.getSelectedText()).toBe("two");
  });

  it("replaces regex captures in one isolated undo transaction", async () => {
    const { editor, controller } = await setup("a1 a2");
    editor.replaceRange(5, 5, "!");
    await controller.setQuery({ text: "a(\\d)", regex: true });
    expect(await controller.replaceAll("b$1")).toMatchObject({ status: "applied", count: 2 });
    expect(editor.getDocument()).toBe("b1 b2!");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a1 a2!");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a1 a2");
  });

  it("replaces the selected match after the first result page", async () => {
    const { editor, controller } = await setup("a a a", { limits: { pageSize: 1 } });
    await controller.setQuery({ text: "a" });
    await controller.findNext();
    await controller.findNext();
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 3 });
    expect(await controller.replaceNext("x")).toEqual({ status: "applied", count: 1 });
    expect(editor.getDocument()).toBe("a x a");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a a a");
  });

  it("continues beyond the default page size before replacing a later match", async () => {
    const source = Array.from({ length: 201 }, () => "a").join(" ");
    const { editor, controller } = await setup(source);
    await controller.setQuery({ text: "a" });
    editor.setSelection(400, 401);
    expect(await controller.replaceNext("x")).toEqual({ status: "applied", count: 1 });
    expect(editor.getDocument()).toBe(`${source.slice(0, 400)}x`);
  });

  it("wraps only after the remaining pages contain no later match", async () => {
    const { editor, controller } = await setup("a a a end", { limits: { pageSize: 1 } });
    await controller.setQuery({ text: "a" });
    editor.setSelection(3);
    expect(await controller.replaceNext("x")).toEqual({ status: "applied", count: 1 });
    expect(editor.getDocument()).toBe("a a x end");
    await controller.setQuery({ text: "a" });
    editor.setSelection(editor.getDocument().length);
    expect(await controller.replaceNext("y")).toEqual({ status: "applied", count: 1 });
    expect(editor.getDocument()).toBe("y a x end");
  });

  it("does not wrap across an unscanned result limit", async () => {
    const { editor, controller } = await setup("a a a", {
      limits: { pageSize: 1, maxResults: 2 },
    });
    await controller.setQuery({ text: "a" });
    editor.setSelection(4, 5);
    expect(await controller.replaceNext("x")).toEqual({ status: "unavailable", count: 0 });
    expect(editor.getDocument()).toBe("a a a");
    editor.setSelection(2, 3);
    expect(await controller.replaceNext("x")).toEqual({ status: "applied", count: 1 });
    expect(editor.getDocument()).toBe("a x a");
  });

  it("rejects a replacement superseded while loading its target page", async () => {
    let release: (() => void) | undefined;
    const scanner: SearchExecutor = {
      async scan(request) {
        if (request.query.replacement === "x" && request.offset > 0) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return scanSearchDocument(request);
      },
      dispose() {},
    };
    const { editor, controller } = await setup("a a b", {
      limits: { pageSize: 1 },
      executor: scanner,
    });
    await controller.setQuery({ text: "a" });
    editor.setSelection(2, 3);
    const replacing = controller.replaceNext("x");
    try {
      await vi.waitFor(() => expect(release).toBeDefined());
      await controller.setQuery({ text: "b" });
    } finally {
      release?.();
    }
    expect(await replacing).toEqual({ status: "conflict", count: 0 });
    expect(editor.getDocument()).toBe("a a b");
  });

  it("rejects stale source ranges even after the text is changed back", async () => {
    const { editor, controller } = await setup();
    await controller.setQuery({ text: "one" });
    const hit = controller.getState().hits[0];
    editor.setDocument("different");
    editor.setDocument("one two one");
    expect(await controller.selectMatch(hit)).toMatchObject({ status: "conflict" });
  });

  it("waits for table blur without applying effective offsets to the old source", async () => {
    const source = "| A | B |\n| --- | --- |\n| x | old |";
    const { editor, container, controller } = await setup(source, { table: true });
    const cells = container.querySelectorAll<HTMLElement>(".nexus-cell");
    const cell = cells[cells.length - 1];
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    cell.tabIndex = -1;
    cell.focus();
    cell.textContent = "pending";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await controller.setQuery({ text: "pending" });
    expect(controller.getState().status).toBe("busy");
    expect(await controller.replaceAll("changed")).toMatchObject({ status: "busy" });
    expect(editor.getDocument()).toBe(source);
    expect(document.activeElement).toBe(cell);
    cell.blur();
    await vi.waitFor(() => expect(controller.getState().hits).toHaveLength(1));
    expect(controller.getState().status).toBe("ready");
    expect(editor.getDocument()).toContain("pending");
  });

  it("keeps read-only searches available but rejects replacement and unsupported selection multiplicity", async () => {
    const readOnly = await setup("one one", { readOnly: true });
    await readOnly.controller.setQuery({ text: "one" });
    expect(await readOnly.controller.findNext()).toMatchObject({ status: "applied" });
    expect(await readOnly.controller.replaceAll("x")).toMatchObject({ status: "read-only" });
    expect(await readOnly.controller.selectAll()).toMatchObject({ status: "unsupported" });
    const multiple = await setup("one one", { multiCursor: true });
    await multiple.controller.setQuery({ text: "one" });
    expect(await multiple.controller.selectAll()).toMatchObject({ status: "applied", count: 2 });
    expect(multiple.editor.getSelections().ranges).toHaveLength(2);
  });

  it("fails closed for an older editor without revision or readonly capabilities", async () => {
    const { editor, controller } = await setup();
    editor.getDocumentRevision = undefined;
    editor.isReadOnly = undefined;
    await controller.setQuery({ text: "one" });
    expect(controller.getState().canApply).toBe(false);
    expect(controller.getState().status).toBe("ready");
    expect(controller.getState().hits).toHaveLength(2);
    expect(await controller.replaceAll("x")).toMatchObject({ status: "unsupported" });
  });

  it("disposes automatically with its editor and removes result decorations", async () => {
    const { editor, controller, container } = await setup();
    controller.open();
    await controller.setQuery({ text: "one" });
    await vi.waitFor(() => expect(container.querySelector(".cm-searchMatch")).not.toBeNull());
    editor.destroy();
    await controller.dispose();
    expect(controller.getState().status).toBe("disposed");
    expect(container.querySelector(".cm-searchMatch")).toBeNull();
  });

  it("does not apply a replacement after a competing query supersedes it", async () => {
    const { editor, controller } = await setup();
    await controller.setQuery({ text: "one" });
    const replace = controller.replaceAll("changed");
    await controller.setQuery({ text: "two" });
    expect(await replace).toMatchObject({ status: "conflict" });
    expect(editor.getDocument()).toBe("one two one");
  });
});
