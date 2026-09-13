import { history } from "@codemirror/commands";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor, type EditorConfig } from "@floatboat/nexus-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlockDragExtension, createBlockDragPlugin } from "../src";

const editors: ReturnType<typeof createEditor>[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture(source = "Alpha\n\nBeta\n\nGamma", options: Partial<EditorConfig> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  let view!: EditorView;
  const editor = createEditor({
    container, initialValue: source, ...options,
    plugins: [
      createBlockDragPlugin(),
      { name: "test", cmExtensions: [history(), codeFolding(), ViewPlugin.define((instance) => { view = instance; return {}; })] },
    ],
  });
  editors.push(editor);
  return { editor, view, container };
}

function down(view: EditorView): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key: "ArrowDown", code: "ArrowDown", altKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }));
}

function pointer(target: EventTarget, type: string, x: number, y: number, buttons = 1): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
  target.dispatchEvent(event);
}

async function startDrag(view: EditorView, container: HTMLElement) {
  // jsdom cannot lay out CodeMirror. These tests cover gesture state/commits;
  // actual hit geometry and scrolling are checked in browser.html.
  for (const element of [view.dom, view.contentDOM, view.scrollDOM]) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 300));
  }
  vi.spyOn(view, "lineBlockAtHeight").mockImplementation((height) => view.lineBlockAt(height < 50 ? 0 : 13));
  let measure = () => {};
  vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
    if (request) measure = () => request.write?.(request.read(view), view);
  });
  const handle = container.querySelector<HTMLButtonElement>(".nexus-block-drag-handle")!;
  let captured = false;
  handle.setPointerCapture = () => { captured = true; };
  handle.hasPointerCapture = () => captured;
  handle.releasePointerCapture = () => { captured = false; };
  pointer(view.dom, "pointermove", 50, 20);
  measure();
  expect(handle.hidden).toBe(false);
  pointer(handle, "pointerdown", 12, 20);
  await Promise.resolve();
  pointer(window, "pointermove", 150, 200);
  expect(container.querySelector(".is-dragging")).not.toBeNull();
  return handle;
}

describe("block drag extension", () => {
  it("does not edit during dragging and commits once on release", async () => {
    const { editor, view, container } = fixture();
    const updates = vi.fn();
    editor.getContributionSink().registerUpdateListener("updates", updates);
    await startDrag(view, container);
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
    pointer(window, "pointerup", 150, 200, 0);
    expect(editor.getDocument()).toBe("Beta\n\nGamma\n\nAlpha");
    expect(updates).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".is-dragging")).toBeNull();
    editor.undo();
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
  });

  it.each(["escape", "blur", "pointercancel", "lostpointercapture", "outside"])("cancels on %s without a partial edit", async (reason) => {
    const { editor, view, container } = fixture();
    const handle = await startDrag(view, container);
    if (reason === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    else if (reason === "outside") pointer(window, "pointerup", 700, 400, 0);
    else if (reason === "lostpointercapture") handle.dispatchEvent(new Event(reason));
    else window.dispatchEvent(new Event(reason));
    pointer(window, "pointerup", 150, 200, 0);
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
    expect(editor.undo()).toBe(false);
    expect(container.querySelector(".is-dragging")).toBeNull();
    expect(container.querySelector<HTMLDivElement>(".nexus-block-drag-preview")?.hidden).toBe(true);
  });

  it("cancels a stale drag when another edit changes the document", async () => {
    const { editor, view, container } = fixture();
    await startDrag(view, container);
    editor.replaceRange(0, 0, "Updated ");
    pointer(window, "pointerup", 150, 200, 0);
    expect(editor.getDocument()).toBe("Updated Alpha\n\nBeta\n\nGamma");
    expect(container.querySelector(".is-dragging")).toBeNull();
  });

  it.each([false, true])("moves and restores the cursor with undo/redo (livePreview=%s)", (livePreview) => {
    const { editor, view } = fixture(undefined, { livePreview });
    editor.setSelection(2);
    down(view);
    expect(editor.getDocument()).toBe("Beta\n\nAlpha\n\nGamma");
    expect(editor.getSelection().head).toBe(8);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
    expect(editor.getSelection().head).toBe(2);
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("Beta\n\nAlpha\n\nGamma");
  });

  it("passes moves through transaction filters and only reports a committed result", () => {
    const { editor, view, container } = fixture();
    const update = vi.fn();
    editor.getContributionSink().registerTransactionFilter("reject-block-move", (context) =>
      context.origin.includes("block-drag") ? { action: "reject", reason: "locked" } : { action: "accept" },
    );
    editor.getContributionSink().registerUpdateListener("observe", update);
    down(view);
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Cannot move the block here");
    expect(editor.undo()).toBe(false);
  });

  it("does not move in read-only mode or during IME composition", () => {
    const readonly = fixture(undefined, { readOnly: true });
    down(readonly.view);
    expect(readonly.editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
    const composing = fixture();
    vi.spyOn(composing.view, "composing", "get").mockReturnValue(true);
    down(composing.view);
    expect(composing.editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
  });

  it("does not move a folded heading", () => {
    const source = "# Heading\n\nBody\n\n# Next\n\nEnd";
    const { editor, view } = fixture(source);
    view.dispatch({ effects: foldEffect.of({ from: 9, to: 16 }) });
    expect(foldedRanges(view.state).size).toBe(1);
    down(view);
    expect(editor.getDocument()).toBe(source);
  });

  it("isolates consecutive moves from typing", () => {
    const { editor, view } = fixture();
    view.dispatch({ changes: { from: 0, insert: "X" }, selection: { anchor: 1 }, userEvent: "input.type" });
    down(view);
    down(view);
    expect(editor.getDocument()).toBe("Beta\n\nGamma\n\nXAlpha");
    editor.undo();
    expect(editor.getDocument()).toBe("Beta\n\nXAlpha\n\nGamma");
    editor.undo();
    expect(editor.getDocument()).toBe("XAlpha\n\nBeta\n\nGamma");
    editor.undo();
    expect(editor.getDocument()).toBe("Alpha\n\nBeta\n\nGamma");
  });

  it("dynamically removes handles and keyboard behavior without recreating the editor", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "Alpha\n\nBeta" });
    editors.push(editor);
    const root = container.querySelector(".cm-editor");
    const registration = editor.getContributionSink().registerExtension("block-drag", createBlockDragExtension());
    await registration.ready;
    expect(container.querySelectorAll(".nexus-block-drag-layer")).toHaveLength(1);
    await registration.dispose();
    expect(container.querySelectorAll(".nexus-block-drag-layer")).toHaveLength(0);
    expect(container.querySelector(".cm-editor")).toBe(root);
    expect(editor.getDocument()).toBe("Alpha\n\nBeta");
    expect(container.querySelector(".cm-content")?.hasAttribute("data-block-drag")).toBe(false);
  });
});
