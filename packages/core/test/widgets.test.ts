import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";
import { resolveDisplay, resolveEventPolicy } from "../src/widget-extension";

describe("widget extension", () => {
  it("renders a widget for a matching AST node type", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render(node, source) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                el.textContent = source;
                return el;
              },
            },
          ],
        },
      ],
    });

    expect(
      container.querySelector("[data-widget='code']")
    ).not.toBeNull();
    editor.destroy();
  });

  it("restores raw markdown when cursor intersects the widget range", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
          ],
        },
      ],
    });

    expect(container.querySelector("[data-widget='code']")).not.toBeNull();

    // Move cursor inside the code block
    editor.setSelection(10);

    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");
    editor.destroy();
  });

  it("uses the match predicate to refine node matching", () => {
    const container = document.createElement("div");
    // Prefix with "Text\n\n" so cursor at 0 doesn't intersect the code blocks
    const editor = createEditor({
      container,
      initialValue:
        "Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "mermaid-widget",
          widgets: [
            {
              nodeType: "code",
              match: (node: any) => node.lang === "mermaid",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "mermaid");
                return el;
              },
            },
          ],
        },
      ],
    });

    expect(container.querySelector("[data-widget='mermaid']")).not.toBeNull();
    // The js code block should NOT be widget-rendered
    expect(container.textContent).toContain("console.log(1)");
    editor.destroy();
  });

  it("calls destroy callback when widget is removed", () => {
    const destroyFn = vi.fn();
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\ncode\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
              destroy: destroyFn,
            },
          ],
        },
      ],
    });

    expect(container.querySelector("[data-widget='code']")).not.toBeNull();

    // Moving cursor into the code block triggers re-render, destroying the old widget
    editor.setSelection(10);

    expect(destroyFn).toHaveBeenCalled();
    editor.destroy();
  });

  it("composes widgets from multiple plugins", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\ncode\n```\n\n---",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
          ],
        },
        {
          name: "break-widget",
          widgets: [
            {
              nodeType: "thematicBreak",
              render() {
                const el = document.createElement("hr");
                el.setAttribute("data-widget", "hr");
                return el;
              },
            },
          ],
        },
      ],
    });

    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    expect(container.querySelector("[data-widget='hr']")).not.toBeNull();
    editor.destroy();
  });

  it("coexists with live preview without overlap", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**",
      livePreview: true,
      plugins: [
        {
          name: "noop-widget",
          widgets: [
            {
              nodeType: "definition",
              render() {
                return document.createElement("div");
              },
            },
          ],
        },
      ],
    });

    // Live preview still renders bold when widget extension is active
    expect(container.textContent).toContain("bold");
    editor.destroy();
  });

  it("renders inline-flagged widgets without forcing them onto their own line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Before `TOKEN` after",
      plugins: [
        {
          name: "inline-widget",
          widgets: [
            {
              nodeType: "inlineCode",
              match: (node: any) => node.value === "TOKEN",
              block: false,
              render() {
                const el = document.createElement("span");
                el.setAttribute("data-widget", "inline");
                el.textContent = "X";
                return el;
              },
            },
          ],
        },
      ],
    });

    // Cursor on a different position so the widget isn't suppressed by
    // selectionIntersects.
    editor.setSelection(0);

    // Inline widget — Decoration.replace must NOT use block:true. The
    // surrounding "Before" / "after" must stay on the same visual line.
    const widget = container.querySelector("[data-widget='inline']") as HTMLElement | null;
    expect(widget).not.toBeNull();
    // CM6 wraps block decorations in a separate cm-line. An inline widget
    // shares its line with the surrounding text — so its closest cm-line
    // should also contain "after".
    const line = widget?.closest(".cm-line") as HTMLElement | null;
    expect(line?.textContent ?? "").toContain("after");
    editor.destroy();
  });

  it("passes a context with from/to/setSelection to render so widgets can build edit affordances", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              ignoreEvents: true,
              render(_node, _source, ctx) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                const btn = document.createElement("button");
                btn.type = "button";
                btn.setAttribute("data-edit", "1");
                btn.addEventListener("mousedown", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                });
                btn.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  ctx?.setSelection(ctx.from);
                  ctx?.focus();
                });
                el.appendChild(btn);
                return el;
              },
            },
          ],
        },
      ],
    });

    const widget = container.querySelector<HTMLElement>("[data-widget='code']");
    expect(widget).not.toBeNull();

    // The widget swallows clicks (ignoreEvents: true); the explicit edit
    // button is the only entry into edit mode.
    const editBtn = widget?.querySelector<HTMLElement>("[data-edit='1']");
    expect(editBtn).not.toBeNull();
    editBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");
    editor.destroy();
  });

  it("renders display:\"inline\" widgets sharing their line with surrounding text", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Before `TOKEN` after",
      plugins: [
        {
          name: "inline-display-widget",
          widgets: [
            {
              nodeType: "inlineCode",
              match: (n: any) => n.value === "TOKEN",
              display: "inline",
              render() {
                const s = document.createElement("span");
                s.setAttribute("data-widget", "inline");
                s.textContent = "X";
                return s;
              },
            },
          ],
        },
      ],
    });

    editor.setSelection(0);

    const widget = container.querySelector("[data-widget='inline']") as HTMLElement | null;
    expect(widget).not.toBeNull();
    // An inline widget shares its line with the surrounding text, so its
    // closest cm-line should also contain "after".
    const line = widget?.closest(".cm-line") as HTMLElement | null;
    expect(line?.textContent ?? "").toContain("after");
    editor.destroy();
  });

  it("renders block by default and stamps the core data-nexus-widget attribute", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\ncode\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              // No display / block → defaults to block.
              nodeType: "code",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
          ],
        },
      ],
    });

    editor.setSelection(0);
    // data-nexus-widget is applied by core (NexusWidget.toDOM), not the plugin.
    expect(container.querySelector("[data-nexus-widget='code']")).not.toBeNull();
    editor.destroy();
  });

  it("eventPolicy:\"widget\" lets only an explicit affordance enter edit mode", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              // Canonical event policy; mirrors the legacy ignoreEvents test.
              eventPolicy: "widget",
              render(_node, _source, ctx) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                const btn = document.createElement("button");
                btn.type = "button";
                btn.setAttribute("data-edit", "1");
                btn.addEventListener("mousedown", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                });
                btn.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  ctx?.enterEditMode();
                });
                el.appendChild(btn);
                return el;
              },
            },
          ],
        },
      ],
    });

    const widget = container.querySelector<HTMLElement>("[data-widget='code']");
    expect(widget).not.toBeNull();

    // A click on the widget body itself must NOT exit widget mode — only the
    // explicit affordance does (proves "widget" event ownership, not just the button path).
    widget?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();

    widget
      ?.querySelector<HTMLElement>("[data-edit='1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");
    editor.destroy();
  });

  it("legacy block:false + ignoreEvents:true still renders inline", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Before `TOKEN` after",
      plugins: [
        {
          name: "legacy-inline-widget",
          widgets: [
            {
              nodeType: "inlineCode",
              match: (n: any) => n.value === "TOKEN",
              block: false,
              ignoreEvents: true,
              render() {
                const s = document.createElement("span");
                s.setAttribute("data-widget", "legacy-inline");
                s.textContent = "X";
                return s;
              },
            },
          ],
        },
      ],
    });

    editor.setSelection(0);
    const widget = container.querySelector("[data-widget='legacy-inline']") as HTMLElement | null;
    expect(widget).not.toBeNull();
    const line = widget?.closest(".cm-line") as HTMLElement | null;
    expect(line?.textContent ?? "").toContain("after");
    editor.destroy();
  });

  it("exposes ctx.range alongside legacy ctx.from/to/setSelection/focus", () => {
    const container = document.createElement("div");
    let captured: Record<string, boolean> | null = null;

    const editor = createEditor({
      container,
      initialValue: "Intro\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render(_node, _source, ctx) {
                captured = {
                  rangeFromEqualsFrom: ctx!.range.from === ctx!.from,
                  rangeToEqualsTo: ctx!.range.to === ctx!.to,
                  sourceIsString: typeof ctx!.range.source === "string",
                  setSelectionIsFn: typeof ctx!.setSelection === "function",
                  focusIsFn: typeof ctx!.focus === "function",
                };
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
          ],
        },
      ],
    });

    expect(captured).toEqual({
      rangeFromEqualsFrom: true,
      rangeToEqualsTo: true,
      sourceIsString: true,
      setSelectionIsFn: true,
      focusIsFn: true,
    });
    editor.destroy();
  });

  function editModeEditor(position?: "start" | "end") {
    const container = document.createElement("div");
    let range: { from: number; to: number } | null = null;
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              eventPolicy: "widget",
              render(_node, _source, ctx) {
                range = { from: ctx!.range.from, to: ctx!.range.to };
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                const btn = document.createElement("button");
                btn.type = "button";
                btn.setAttribute("data-edit", "1");
                btn.addEventListener("click", () => ctx?.enterEditMode(position));
                el.appendChild(btn);
                return el;
              },
            },
          ],
        },
      ],
    });
    return { container, editor, getRange: () => range! };
  }

  it("enterEditMode() defaults to source start and reveals raw markdown", () => {
    const { container, editor, getRange } = editModeEditor();
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();

    container
      .querySelector<HTMLElement>("[data-edit='1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");
    // Default position is "start": caret lands at the source-range start, not the end.
    expect(editor.getSelection().anchor).toBe(getRange().from);
    editor.destroy();
  });

  it("enterEditMode(\"end\") reveals raw markdown at the source end", () => {
    const { container, editor, getRange } = editModeEditor("end");
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();

    container
      .querySelector<HTMLElement>("[data-edit='1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");
    // "end" must honor its argument: caret lands at the source-range end, not the start.
    expect(editor.getSelection().anchor).toBe(getRange().to);
    editor.destroy();
  });

  it("produces no extensions when no widgets are registered", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**",
      livePreview: true,
    });

    expect(container.textContent).toContain("bold");
    editor.destroy();
  });
});

describe("widget field resolvers", () => {
  // The resolvers only read display/eventPolicy/block/ignoreEvents — render /
  // nodeType are irrelevant, so minimal cast objects are enough.
  const base = { nodeType: "x", render: () => document.createElement("div") };

  it("resolveDisplay maps canonical, legacy, and unknown values", () => {
    expect(resolveDisplay(base as any)).toBe("block");
    expect(resolveDisplay({ ...base, display: "inline" } as any)).toBe("inline");
    expect(resolveDisplay({ ...base, block: false } as any)).toBe("inline");
    // Canonical display wins over a conflicting legacy block (3.4).
    expect(resolveDisplay({ ...base, display: "inline", block: true } as any)).toBe("inline");
    // Unknown display → treated as absent → default block (3.8).
    expect(resolveDisplay({ ...base, display: "flow" } as any)).toBe("block");
    // Unknown display → treated as absent → legacy block branch (3.8).
    expect(resolveDisplay({ ...base, display: "flow", block: false } as any)).toBe("inline");
  });

  it("resolveEventPolicy maps canonical, legacy, and unknown values", () => {
    expect(resolveEventPolicy(base as any)).toBe("editor");
    expect(resolveEventPolicy({ ...base, eventPolicy: "widget" } as any)).toBe("widget");
    expect(resolveEventPolicy({ ...base, ignoreEvents: true } as any)).toBe("widget");
    // Canonical eventPolicy wins over a conflicting legacy ignoreEvents (3.4).
    expect(
      resolveEventPolicy({ ...base, eventPolicy: "editor", ignoreEvents: true } as any)
    ).toBe("editor");
    // Unknown eventPolicy → treated as absent → legacy ignoreEvents branch (3.8).
    expect(
      resolveEventPolicy({ ...base, eventPolicy: "bad", ignoreEvents: true } as any)
    ).toBe("widget");
  });
});
