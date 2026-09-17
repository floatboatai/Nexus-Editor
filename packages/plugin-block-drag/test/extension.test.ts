import { history } from "@codemirror/commands";
import { codeFolding, foldEffect } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor, type EditorConfig } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlockDragExtension, createBlockDragPlugin } from "../src";
import { canMoveBlock, moveBlock, stopBlockDrag } from "../src/extension";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function editorFor(
  source = "First\n\nSecond\n\nThird",
  config: Partial<EditorConfig> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  let view!: EditorView;
  const readonly = new Compartment();
  const editor = createEditor({
    container,
    initialValue: source,
    ...config,
    plugins: [
      createGfmPreset(),
      createBlockDragPlugin(),
      {
        name: "test-host",
        cmExtensions: [
          history(),
          codeFolding(),
          readonly.of([]),
          ViewPlugin.define((value) => {
            view = value;
            return {};
          }),
        ],
      },
    ],
  });
  cleanups.push(() => editor.destroy());
  return { editor, view, container, readonly };
}

function pointer(
  target: EventTarget,
  type: string,
  y: number,
  options: Partial<PointerEvent> = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 30,
    clientY: y,
    button: 0,
    buttons: 1,
  });
  Object.defineProperties(event, Object.fromEntries(
    Object.entries({ pointerId: 9, pointerType: "mouse", ...options })
      .map(([key, value]) => [key, { value }]),
  ));
  target.dispatchEvent(event);
}

function geometry(view: EditorView) {
  for (const element of [view.dom, view.contentDOM, view.scrollDOM]) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
  }
  vi.spyOn(view, "lineBlockAtHeight").mockImplementation((height) =>
    view.lineBlockAt(height < 80 ? 0 : view.state.doc.length),
  );
  let measure = (): void => {};
  vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
    if (request) measure = () => request.write?.(request.read(view), view);
  });
  pointer(view.dom, "pointermove", 5);
  measure();
  const handle = view.dom.querySelector<HTMLButtonElement>(".nexus-block-drag-handle")!;
  let captured = false;
  handle.setPointerCapture = () => {
    captured = true;
  };
  handle.hasPointerCapture = () => captured;
  handle.releasePointerCapture = () => {
    captured = false;
  };
  return { handle, measure: () => measure() };
}

function start(view: EditorView) {
  const controls = geometry(view);
  expect(controls.handle.hidden).toBe(false);
  pointer(controls.handle, "pointerdown", 5);
  pointer(window, "pointermove", 240);
  controls.measure();
  return controls;
}

describe("block drag interaction", () => {
  it.each([true, false])(
    "moves only on release and restores content and selection (preview %s)",
    (livePreview) => {
      const { editor, view } = editorFor(undefined, { livePreview });
      editor.setSelection(2);
      start(view);
      expect(editor.getDocument()).toBe("First\n\nSecond\n\nThird");
      pointer(window, "pointerup", 240, { buttons: 0 });
      expect(editor.getDocument()).toBe("Second\n\nThird\n\nFirst");
      expect(editor.getSelection().head).toBe(17);
      expect(editor.undo()).toBe(true);
      expect(editor.getDocument()).toBe("First\n\nSecond\n\nThird");
      expect(editor.getSelection().head).toBe(2);
      expect(editor.redo()).toBe(true);
    },
  );

  it.each([
    "Escape", "pointercancel", "blur", "outside", "stale", "readonly", "stop",
  ])("cancels on %s", (reason) => {
    const { editor, view, readonly } = editorFor();
    start(view);
    if (reason === "Escape") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
    if (reason === "pointercancel") pointer(window, reason, 240);
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    if (reason === "stale") editor.replaceRange(0, 0, "New ");
    if (reason === "readonly") {
      view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
    }
    if (reason === "stop") stopBlockDrag(view);
    pointer(window, "pointerup", 240, {
      buttons: 0,
      clientX: reason === "outside" ? 600 : 30,
    });
    expect(editor.getDocument()).toBe(`${reason === "stale" ? "New " : ""}First\n\nSecond\n\nThird`);
    expect(view.dom.querySelector(".is-dragging")).toBeNull();
  });

  it("ignores touch, clicks below threshold, and unrelated pointer release", () => {
    const { editor, view } = editorFor();
    const { handle } = geometry(view);
    pointer(handle, "pointerdown", 5, { pointerType: "touch" });
    pointer(window, "pointermove", 240);
    pointer(window, "pointerup", 240);
    expect(editor.getDocument()).toBe("First\n\nSecond\n\nThird");
    pointer(handle, "pointerdown", 5);
    pointer(window, "pointermove", 7);
    pointer(window, "pointerup", 7);
    expect(editor.undo()).toBe(false);
    pointer(handle, "pointerdown", 5);
    pointer(window, "pointermove", 240);
    pointer(window, "pointerup", 240, { pointerId: 10 });
    expect(editor.getDocument()).toBe("First\n\nSecond\n\nThird");
    pointer(window, "pointerup", 240);
    expect(editor.getDocument()).toBe("Second\n\nThird\n\nFirst");
  });

  it("keeps each keyboard move separate from typing in undo history", () => {
    const { editor, view } = editorFor();
    view.dispatch({
      changes: { from: 0, insert: "X" },
      userEvent: "input.type",
      selection: { anchor: 1 },
    });
    expect(canMoveBlock(view, -1)).toBe(false);
    expect(moveBlock(view, 1)).toBe(true);
    moveBlock(view, 1);
    editor.undo();
    expect(editor.getDocument()).toBe("Second\n\nXFirst\n\nThird");
    editor.undo();
    expect(editor.getDocument()).toBe("XFirst\n\nSecond\n\nThird");
    editor.undo();
    expect(editor.getDocument()).toBe("First\n\nSecond\n\nThird");
  });

  it("reports host rejection without creating undo history", () => {
    const { editor, view } = editorFor();
    editor.getContributionSink().registerTransactionFilter("deny", () => ({ action: "reject" }));
    moveBlock(view, 1);
    expect(view.dom.querySelector('[role="status"]')?.textContent).toBe("Block could not be moved");
    expect(editor.undo()).toBe(false);
  });

  it("does not handle keyboard moves in read-only, composing, folded, or stopped editors", () => {
    const readonly = editorFor(undefined, { readOnly: true });
    expect(moveBlock(readonly.view, 1)).toBe(false);
    const composing = editorFor();
    vi.spyOn(composing.view, "composing", "get").mockReturnValue(true);
    expect(moveBlock(composing.view, 1)).toBe(false);
    const folded = editorFor("# Title\n\nBody\n\n# End");
    folded.view.dispatch({ effects: foldEffect.of({ from: 7, to: 13 }) });
    expect(moveBlock(folded.view, 1)).toBe(false);
    const stopped = editorFor();
    stopBlockDrag(stopped.view);
    expect(moveBlock(stopped.view, 1)).toBe(false);
  });

  it("removes handles and keys on dynamic disposal", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "First\n\nSecond" });
    cleanups.push(() => editor.destroy());
    const registration = editor.getContributionSink().registerExtension(
      "optional-drag",
      createBlockDragExtension(),
    );
    await registration.ready;
    expect(container.querySelectorAll(".nexus-block-drag")).toHaveLength(1);
    await registration.dispose();
    expect(container.querySelector(".nexus-block-drag")).toBeNull();
    expect(container.querySelector("[data-block-reorder]")).toBeNull();
  });

  it.each(["keyboard", "pointer"])("cancels the move when a table commit changes block identity (%s)", async (trigger) => {
    const original = "| A | B |\n| --- | --- |\n| old | value |\n\nAfter\n\nTail";
    const { editor, view, container } = editorFor(original, { livePreview: true });
    const cell = container.querySelectorAll<HTMLElement>(".nexus-cell")[2];
    let rejectSave = true;
    editor.getContributionSink().registerTransactionFilter("cell-guard", (context) =>
      rejectSave && context.changes.length > 0 ? { action: "reject" } : { action: "accept" },
    );
    cell.tabIndex = -1;
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    cell.focus();
    cell.textContent = "old\n\nnew block";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    cell.blur();
    await Promise.resolve();
    expect(editor.getDocument()).toBe(original);
    editor.setSelection(original.indexOf("After"));
    view.focus();
    rejectSave = false;

    if (trigger === "keyboard") {
      expect(moveBlock(view, 1)).toBe(true);
    } else {
      const controls = geometry(view);
      vi.mocked(view.lineBlockAtHeight).mockImplementation((height) => view.lineBlockAt(
        height < 80 ? 0 : height < 200 ? view.state.doc.toString().indexOf("After") : view.state.doc.length,
      ));
      pointer(view.dom, "pointermove", 120);
      controls.measure();
      expect(controls.handle.hidden).toBe(false);
      pointer(controls.handle, "pointerdown", 120);
      pointer(window, "pointermove", 240);
      controls.measure();
      pointer(window, "pointerup", 240, { buttons: 0 });
    }

    expect(editor.getDocument()).toBe(original.replace("old", "old\n\nnew block"));
    expect(view.dom.querySelector('[role="status"]')?.textContent).toBe("Block could not be moved");
    expect(view.dom.querySelector(".is-dragging")).toBeNull();
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
  });

  it.each([false, true])("preserves table input and blocks rejected saves (reject %s)", (reject) => {
    const original = "| A | B |\n| --- | --- |\n| old | value |\n\nEnd";
    const { editor, view, container } = editorFor(original, { livePreview: true });
    const cell = container.querySelectorAll<HTMLElement>("tr")[2]
      .querySelector<HTMLElement>(".nexus-cell")!;
    cell.tabIndex = -1;
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    cell.focus();
    cell.textContent = "updated";
    cell.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "updated",
    }));
    const registration = editor.getContributionSink().registerTransactionFilter(
      "cell-guard",
      (context) => reject && context.changes.some((change) => change.insert.includes("updated"))
        ? { action: "reject" }
        : { action: "accept" },
    );
    start(view);
    pointer(window, "pointerup", 240);
    if (reject) {
      expect(editor.getDocument()).toBe(original);
      expect(container.querySelectorAll<HTMLElement>("tr")[2].textContent).toContain("updated");
      registration.dispose();
      start(view);
      pointer(window, "pointerup", 240);
    }
    expect(editor.getDocument()).toBe("End\n\n| A | B |\n| --- | --- |\n| updated | value |");
    editor.undo();
    expect(editor.getDocument()).toContain("updated");
    expect(editor.getDocument().startsWith("| A | B |")).toBe(true);
  });
});

describe("block handle navigation", () => {
  it("keeps keyboard focus on the handle across repeated moves", () => {
    const { editor, view } = editorFor();
    const { handle, measure } = geometry(view);
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    measure();
    expect(document.activeElement).toBe(handle);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(editor.getDocument()).toBe("Second\n\nThird\n\nFirst");
  });

  it("does not insert a block into a collapsed heading's body", () => {
    const { editor, view } = editorFor("# Heading\n\nHidden\n\nLast");
    view.dispatch({ effects: foldEffect.of({ from: 9, to: 17 }) });
    editor.setSelection(19);
    expect(canMoveBlock(view, -1)).toBe(false);
    moveBlock(view, -1);
    expect(editor.getDocument()).toBe("# Heading\n\nHidden\n\nLast");
  });
});

it("cancels if the source heading is folded during a drag", () => {
  const source = "# Heading\n\nHidden\n\nLast";
  const { editor, view } = editorFor(source);
  start(view);
  view.dispatch({ effects: foldEffect.of({ from: 9, to: 17 }) });
  pointer(window, "pointerup", 240);
  expect(editor.getDocument()).toBe(source);
  expect(view.dom.querySelector(".is-dragging")).toBeNull();
});
