import { history, undo } from "@codemirror/commands";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI } from "../src/index";
import { createGfmPreset } from "../../preset-gfm/src/index";

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function makeClipboardEvent(type: "copy" | "cut" | "paste"): ClipboardEvent {
  return new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
}

function createCapturedEditor(initialValue = "hello", multiCursor = false): {
  editor: EditorAPI;
  container: HTMLElement;
  view: () => EditorView;
} {
  const container = document.createElement("div");
  let captured: EditorView | null = null;
  const editor = createEditor({
    container,
    initialValue,
    multiCursor,
    plugins: [
      {
        name: "capture-view",
        cmExtensions: [
          history(),
          codeFolding(),
          ViewPlugin.define((view) => {
            captured = view;
            return {};
          }),
        ],
      },
    ],
  });
  return {
    editor,
    container,
    view: () => {
      if (!captured) throw new Error("Expected a captured EditorView");
      return captured;
    },
  };
}

describe("dynamic editor contributions", () => {
  it("installs and removes owner-scoped CM6 extensions without replacing the view", async () => {
    const { editor, view } = createCapturedEditor();
    const originalView = view();
    let created = 0;
    let destroyed = 0;
    const registration = editor.getContributionSink().registerExtension(
      "sample-plugin",
      ViewPlugin.define(() => {
        created += 1;
        return { destroy: () => void (destroyed += 1) };
      })
    );

    await registration.ready;

    expect(created).toBe(1);
    expect(view()).toBe(originalView);
    expect(editor.getDocument()).toBe("hello");

    await registration.dispose();
    await registration.dispose();

    expect(registration.disposed).toBe(true);
    expect(destroyed).toBe(1);
    expect(view()).toBe(originalView);
    editor.destroy();
  });

  it("preserves document, selection, and undo history across reconfiguration", async () => {
    const { editor, view } = createCapturedEditor("start");
    const originalView = view();
    editor.setSelection(5);
    editor.replaceSelection("!");
    const beforeSelection = editor.getSelection();
    const registration = editor.getContributionSink().registerExtension(
      "history-safe",
      EditorView.contentAttributes.of({ "data-dynamic": "true" })
    );

    await registration.ready;

    expect(view()).toBe(originalView);
    expect(editor.getDocument()).toBe("start!");
    expect(editor.getSelection()).toEqual(beforeSelection);
    expect(undo(originalView)).toBe(true);
    expect(editor.getDocument()).toBe("start");

    await registration.dispose();
    editor.destroy();
  });

  it("preserves multi-selection, fold, scroll, focus, history, and composed content", async () => {
    const initial = "# Heading\nfolded line\n\nlast";
    const { editor, view } = createCapturedEditor(initial, true);
    const originalView = view();
    editor.setSelections([
      { anchor: initial.length, head: initial.length },
      { anchor: 2, head: 9 },
    ], 1);
    originalView.dispatch({ effects: foldEffect.of({ from: 9, to: 21 }) });
    originalView.scrollDOM.scrollTop = 37;
    editor.focus();
    const focused = originalView.hasFocus;

    const content = originalView.contentDOM;
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    editor.dispatchTransaction({
      changes: [{ from: initial.length, to: initial.length, insert: "\n中" }],
      origin: ["ime-test"],
      userEvent: "input.type.compose",
    });
    const beforeDocument = editor.getDocument();
    const beforeSelection = editor.getSelections();
    const beforeFolds: Array<{ from: number; to: number }> = [];
    foldedRanges(originalView.state).between(0, originalView.state.doc.length, (from, to) => {
      beforeFolds.push({ from, to });
    });

    let installed = 0;
    const registration = editor.getContributionSink().registerExtension(
      "full-state-safe",
      ViewPlugin.define(() => {
        installed += 1;
        return {};
      }),
    );
    await nextFrame();
    expect(installed).toBe(0);
    expect(editor.getDocument()).toBe(beforeDocument);

    content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await registration.ready;

    const afterFolds: Array<{ from: number; to: number }> = [];
    foldedRanges(originalView.state).between(0, originalView.state.doc.length, (from, to) => {
      afterFolds.push({ from, to });
    });
    expect(view()).toBe(originalView);
    expect(editor.getDocument()).toBe(beforeDocument);
    expect(editor.getDocument()).toContain("中");
    expect(editor.getSelections()).toEqual(beforeSelection);
    expect(afterFolds).toEqual(beforeFolds);
    expect(originalView.scrollDOM.scrollTop).toBe(37);
    expect(originalView.hasFocus).toBe(focused);

    await registration.dispose();
    expect(view()).toBe(originalView);
    expect(editor.getSelections()).toEqual(beforeSelection);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(initial);
    editor.destroy();
  });

  it("orders DOM hooks by priority and keeps post-consume observers read-only", async () => {
    const { editor, container } = createCapturedEditor();
    const sink = editor.getContributionSink();
    const calls: string[] = [];
    sink.registerDomEvent("low", "paste", () => {
      calls.push("low");
    }, { priority: -10 });
    sink.registerDomEvent("observer", "paste", (event) => {
      calls.push(`observer:${event.defaultPrevented}`);
    }, { priority: -20, observeAfterConsumed: true });
    sink.registerDomEvent("bubble-observer", "paste", (event) => {
      calls.push(`bubble-observer:${event.defaultPrevented}`);
      return "consume";
    }, { phase: "bubble", priority: 20, observeAfterConsumed: true });
    sink.registerDomEvent("high", "paste", (_event, context) => {
      calls.push(`high:${context.surface}`);
      return "consume";
    }, { priority: 10 });
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");
    const event = makeClipboardEvent("paste");

    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual(["high:document", "observer:true", "bubble-observer:true"]);
    editor.destroy();
  });

  it("does not infer a paste event from Ctrl/Cmd+V", () => {
    const { editor, container } = createCapturedEditor();
    const paste = vi.fn();
    const keydown = vi.fn();
    const sink = editor.getContributionSink();
    sink.registerDomEvent("clipboard", "paste", paste);
    sink.registerDomEvent("keyboard", "keydown", keydown);
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");

    content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(keydown).toHaveBeenCalledTimes(1);
    expect(paste).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("delays physical extension installation until a mouse interaction ends", async () => {
    const { editor, container } = createCapturedEditor();
    let created = 0;
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const registration = editor.getContributionSink().registerExtension(
      "interaction-safe",
      ViewPlugin.define(() => {
        created += 1;
        return {};
      })
    );

    await nextFrame();
    expect(created).toBe(0);

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await registration.ready;
    expect(created).toBe(1);
    editor.destroy();
  });

  it("delays physical extension installation until IME composition ends", async () => {
    const { editor, container } = createCapturedEditor();
    let created = 0;
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const registration = editor.getContributionSink().registerExtension(
      "ime-safe",
      ViewPlugin.define(() => {
        created += 1;
        return {};
      })
    );

    await nextFrame();
    expect(created).toBe(0);

    content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await registration.ready;
    expect(created).toBe(1);
    editor.destroy();
  });

  it("installs one root dispatcher for each supported real DOM event", () => {
    const { editor, container } = createCapturedEditor();
    const sink = editor.getContributionSink();
    const calls: string[] = [];
    const types = [
      "copy",
      "cut",
      "paste",
      "beforeinput",
      "drop",
      "contextmenu",
      "keydown",
    ] as const;
    for (const type of types) {
      sink.registerDomEvent("catalog", type, (event) => {
        calls.push(event.type);
      });
    }
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected content DOM");
    for (const type of types) {
      const event = type === "keydown"
        ? new KeyboardEvent(type, { key: "x", bubbles: true, cancelable: true })
        : type === "beforeinput"
          ? new InputEvent(type, { inputType: "insertText", bubbles: true, cancelable: true })
          : type === "contextmenu"
            ? new MouseEvent(type, { bubbles: true, cancelable: true })
            : new Event(type, { bubbles: true, cancelable: true });
      content.dispatchEvent(event);
    }

    expect(calls).toEqual(types);
    editor.destroy();
  });

  it("recognizes widget surfaces even when CM6 ignores their events", async () => {
    const container = document.createElement("div");
    const parser = {
      parse() {
        return {
          type: "root" as const,
          children: [{
            type: "custom",
            value: "token",
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 6, offset: 5 },
            },
          }],
        } as never;
      },
    };
    const editor = createEditor({
      container,
      initialValue: "token\n",
      parser,
      plugins: [{
        name: "widget",
        widgets: [{
          nodeType: "custom",
          ignoreEvents: true,
          render: () => {
            const element = document.createElement("button");
            element.textContent = "Widget";
            return element;
          },
        }],
      }],
    });
    editor.setSelection(editor.getDocument().length);
    const surfaces: string[] = [];
    editor.getContributionSink().registerDomEvent("surface", "copy", (_event, context) => {
      surfaces.push(context.surface);
      context.insertMarkdown("must-not-enter-document");
      expect(context.replaceTargetSelection("also-must-not-enter")).toBe(false);
    });
    const widget = container.querySelector<HTMLElement>("[data-nexus-widget]");
    if (!widget) throw new Error("Expected widget DOM");

    widget.dispatchEvent(makeClipboardEvent("copy"));

    expect(surfaces).toEqual(["widget"]);
    expect(editor.getDocument()).toBe("token\n");
    editor.destroy();
  });

  it("routes table range replacement through the table target instead of the CM6 selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createGfmPreset()],
    });
    const cells = container.querySelectorAll<HTMLElement>("tr")[2]
      ?.querySelectorAll<HTMLElement>(".nexus-cell");
    const first = cells?.[0];
    const second = cells?.[1];
    if (!first || !second) throw new Error("Expected table cells");
    first.getBoundingClientRect = () => new DOMRect(0, 0, 50, 30);
    second.getBoundingClientRect = () => new DOMRect(50, 0, 50, 30);
    first.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 25,
      clientY: 15,
    }));
    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      button: 0,
      clientX: 75,
      clientY: 15,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 75,
      clientY: 15,
    }));
    editor.setSelection(0);
    const seen: Array<{ surface: string; selected: string; replaced: boolean }> = [];
    editor.getContributionSink().registerDomEvent("table-target", "paste", (_event, context) => {
      seen.push({
        surface: context.surface,
        selected: context.inputTarget?.getSelectedText() ?? "",
        replaced: context.replaceTargetSelection("x\ty"),
      });
      return "consume";
    });
    const paste = makeClipboardEvent("paste");
    first.dispatchEvent(paste);

    expect(seen).toEqual([{ surface: "table", selected: "1\t2", replaced: true }]);
    expect(editor.getDocument()).toContain("| x | y |");
    expect(editor.getDocument().startsWith("x")).toBe(false);
    const afterCells = container.querySelectorAll<HTMLElement>("tr")[2]
      ?.querySelectorAll<HTMLElement>(".nexus-cell");
    expect(afterCells?.[0]?.textContent?.trim()).toBe("x");
    expect(afterCells?.[1]?.textContent?.trim()).toBe("y");
    editor.destroy();
    container.remove();
  });
});
