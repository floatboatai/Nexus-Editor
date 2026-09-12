import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createSelectionToolbarUI, type SelectionToolbarUIOptions } from "../src/index";
import { toggleInlineCode } from "@floatboat/nexus-plugin-formatting";

const cleanup: (() => void)[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const rect = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);

function inlineCodeGroups() {
  return [{ buttons: [{ id: "inline-code", title: "Inline code", icon: () => document.createElement("span"), action: toggleInlineCode }] }];
}

async function fixture(options: Partial<SelectionToolbarUIOptions> = {}, initialValue = "hello world", readOnly = false) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createEditor({ container: root, initialValue, readOnly, multiCursor: true, plugins: [createHistoryPlugin()] });
  const view = EditorView.findFromDOM(root.querySelector(".cm-editor")!)!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(20, 20, 700, 500));
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue(rect(20, 20, 700, 500));
  const coords = vi.spyOn(view, "coordsAtPos").mockImplementation((pos) => rect(50 + pos * 7, 100, 0, 20));
  const ui = createSelectionToolbarUI(editor, { editorRoot: root, groups: inlineCodeGroups(), ...options });
  vi.spyOn(ui.element, "getBoundingClientRect").mockReturnValue(rect(0, 0, 40, 40));
  await ui.ready;
  cleanup.push(() => { ui.destroy(); editor.destroy(); root.remove(); });
  function pointer(type: string, target: EventTarget = view.contentDOM, pointerType = "mouse") {
    const event = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    target.dispatchEvent(event);
  }
  async function select(anchor = 6, head = 11) {
    editor.focus();
    pointer("pointerdown");
    editor.setSelection(anchor, head);
    pointer("pointerup", document);
    await tick();
  }
  return { root, editor, view, ui, select, pointer, coords };
}

afterEach(() => {
  for (const destroy of cleanup.splice(0)) destroy();
  vi.restoreAllMocks();
});

describe("selection toolbar sessions", () => {
  it("opens only after a user gesture, persists Escape, and permits the same range again", async () => {
    const { editor, view, ui, pointer, select } = await fixture();
    editor.focus(); editor.setSelection(6, 11); await tick();
    expect(ui.element.hidden).toBe(true);
    pointer("pointerdown"); await tick();
    expect(ui.element.hidden).toBe(true);
    pointer("pointerup", document); await tick();
    expect(ui.element.hidden).toBe(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event("scroll")); await tick();
    expect(ui.element.hidden).toBe(true);
    expect(editor.getSelection()).toEqual({ anchor: 6, head: 11 });
    const hiddenEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(hiddenEscape);
    expect(hiddenEscape.defaultPrevented).toBe(false);
    await select(); expect(ui.element.hidden).toBe(false);
  });

  it("waits for keyboard selection release and preserves body arrow/Tab handling", async () => {
    const { editor, view, ui } = await fixture();
    editor.focus(); editor.setSelection(6);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    editor.setSelection(6, 11); await tick();
    expect(ui.element.hidden).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    editor.setSelection(6, 10); // Native selectionchange can arrive after keyup.
    await tick();
    expect(ui.element.hidden).toBe(false);
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(arrow);
    expect(ui.element.hidden).toBe(true);
  });

  it.each([
    ["   ", 0, 3], ["```js\nhello\n```", 6, 11], ["    code", 4, 8],
    ["a | b\n-- | --\nx | y", 0, 5], ["before\n\n```\ncode\n```\n\nafter", 0, 26],
  ])("excludes whitespace and block surfaces: %s", async (text, from, to) => {
    const { ui, select } = await fixture({}, text);
    await select(from, to); expect(ui.element.hidden).toBe(true);
  });

  it("rejects read-only, multiple ranges, touch, widgets, composition and outside interaction", async () => {
    const readonly = await fixture({}, "hello world", true);
    await readonly.select(); expect(readonly.ui.element.hidden).toBe(true);
    const f = await fixture(); await f.select();
    f.editor.setSelections([{ anchor: 0, head: 2 }, { anchor: 6, head: 11 }], 0);
    await tick(); expect(f.ui.element.hidden).toBe(true);
    f.pointer("pointerdown", f.view.contentDOM, "touch"); f.editor.setSelection(6, 11);
    f.pointer("pointerup", document, "touch"); await tick(); expect(f.ui.element.hidden).toBe(true);
    await f.select(); f.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(f.ui.element.hidden).toBe(true);
    f.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await f.select(); f.pointer("pointerdown", document.body); expect(f.ui.element.hidden).toBe(true);
  });

  it("keeps final selection and shared undo semantics through repeated inline-code actions", async () => {
    const f = await fixture(); const reference = await fixture();
    await f.select(); reference.editor.setSelection(6, 11);
    const button = f.ui.element.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("mousedown", { cancelable: true })); button.click();
    toggleInlineCode(reference.editor); await tick();
    expect(f.editor.getDocument()).toBe("hello `world`");
    expect(f.editor.getSelection()).toEqual({ anchor: 7, head: 12 });
    expect(f.ui.element.hidden).toBe(false);
    button.click(); toggleInlineCode(reference.editor); await tick();
    expect(f.editor.getDocument()).toBe("hello world");
    expect(f.editor.getSelection()).toEqual({ anchor: 6, head: 11 });
    expect(f.ui.element.hidden).toBe(false);
    f.editor.undo(); reference.editor.undo();
    expect(f.editor.getDocument()).toBe("hello `world`");
    expect(f.editor.getDocument()).toBe(reference.editor.getDocument());
    expect(f.editor.getSelection()).toEqual(reference.editor.getSelection());
  });

  it("invokes only the configured bridge, blocks duplicate clicks and ignores stale completion", async () => {
    let resolve!: () => void;
    const bridge = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const f = await fixture({ onAction: bridge }); await f.select();
    const button = f.ui.element.querySelector("button")!;
    button.click(); button.click(); expect(bridge).toHaveBeenCalledTimes(1);
    expect(f.editor.getDocument()).toBe("hello world");
    f.editor.setDocument("another document", { silent: true });
    resolve(); await tick(); expect(f.ui.element.hidden).toBe(true);
    expect(f.editor.getDocument()).toBe("another document");
  });

  it("keeps a newly selected session when an older action rejects", async () => {
    let reject!: (reason: Error) => void;
    const f = await fixture({ onAction: () => new Promise<void>((_, fail) => { reject = fail; }) });
    await f.select(); f.ui.element.querySelector("button")!.click();
    await f.select(0, 5);
    expect(f.ui.element.hidden).toBe(false);
    reject(new Error("Old request failed")); await tick();
    expect(f.ui.element.hidden).toBe(false);
    expect(f.editor.getSelection()).toEqual({ anchor: 0, head: 5 });
  });

  it("supports asynchronous format commands even for a whole-document selection", async () => {
    const f = await fixture({ onAction: async (_, editor) => { await Promise.resolve(); toggleInlineCode(editor); } });
    await f.select(0, 11); f.ui.element.querySelector("button")!.click(); await tick();
    expect(f.editor.getDocument()).toBe("`hello world`"); expect(f.ui.element.hidden).toBe(false);
  });

  it("supports explicit groups, deliberate keyboard focus and idempotent early disposal", async () => {
    const action = vi.fn();
    const groups = [{ buttons: ["First", "Second"].map((title) => ({ id: title, title, icon: () => document.createElement("span"), action })) }];
    const f = await fixture({ groups, focusShortcut: true }); await f.select();
    f.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true }));
    const buttons = f.ui.element.querySelectorAll("button"); expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(f.ui.element.hidden).toBe(true); expect(document.activeElement).toBe(f.view.contentDOM);
    expect(document.querySelector(".nexus-selection-toolbar-tooltip")).toBeNull();
    const empty = await fixture({ groups: [] }); await empty.select(); expect(empty.ui.element.hidden).toBe(true);
    const early = createSelectionToolbarUI(f.editor, { editorRoot: f.root, groups: [] }); early.destroy(); early.destroy();
    await early.ready; expect(early.element.isConnected).toBe(false);
  });

  it("repositions at visual head, flips and restores only sessions hidden by geometry", async () => {
    const f = await fixture(); await f.select(); expect(f.ui.element.style.top).toBe("52px");
    f.coords.mockImplementation((pos) => rect(pos * 7 + 50, pos === 11 ? 300 : 100, 0, 20));
    window.dispatchEvent(new Event("scroll")); await tick(); expect(f.ui.element.style.top).toBe("328px");
    await f.select(11, 6); expect(f.ui.element.style.top).toBe("52px");
    f.coords.mockReturnValue(rect(50, 25, 0, 20));
    window.dispatchEvent(new Event("resize")); await tick(); expect(f.ui.element.style.top).toBe("53px");
    f.coords.mockReturnValue(null); window.dispatchEvent(new Event("scroll")); await tick(); expect(f.ui.element.hidden).toBe(true);
    f.coords.mockReturnValue(rect(50, 100, 0, 20)); window.dispatchEvent(new Event("scroll")); await tick(); expect(f.ui.element.hidden).toBe(false);
    f.ui.dismiss(); window.dispatchEvent(new Event("scroll")); await tick(); expect(f.ui.element.hidden).toBe(true);
  });
});
