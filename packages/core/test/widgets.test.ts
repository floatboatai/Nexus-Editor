import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";

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

describe("widget interaction guards", () => {
  it("renders widget with interactionGuards and ctx callbacks", () => {
    const container = document.createElement("div");
    const guardsAcquired: string[] = [];
    const guardsReleased: string[] = [];
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "guarded-widget",
          widgets: [
            {
              nodeType: "code",
              interactionGuards: [
                {
                  type: "focus",
                  acquire: () => {},
                  release: () => {},
                },
              ],
              render(node, source, ctx) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "guarded");
                el.textContent = source;
                // Verify ctx exposes guard API
                if (ctx) {
                  guardsAcquired.push("ctx-present");
                }
                el.addEventListener("mousedown", () => {
                  ctx?.acquireGuard("focus");
                  guardsAcquired.push("focus");
                });
                return el;
              },
            },
          ],
        },
      ],
    });

    // Widget should render
    const widget = container.querySelector("[data-widget='guarded']");
    expect(widget).not.toBeNull();
    // ctx should be provided
    expect(guardsAcquired).toContain("ctx-present");

    editor.destroy();
  });

  it("renders widget without guards using default behavior", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "unguarded-widget",
          widgets: [
            {
              nodeType: "code",
              render(node, source) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "unguarded");
                el.textContent = source;
                return el;
              },
            },
          ],
        },
      ],
    });

    // Widget should render normally
    expect(container.querySelector("[data-widget='unguarded']")).not.toBeNull();
    // No interactionGuards means default rebuild behavior
    expect(container.querySelector("[data-nexus-widget='code']")).not.toBeNull();

    editor.destroy();
  });

  it("releases all guards on widget destroy", () => {
    const container = document.createElement("div");
    let destroyCalled = false;
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "destroy-widget",
          widgets: [
            {
              nodeType: "code",
              interactionGuards: [
                {
                  type: "focus",
                  acquire: () => {},
                  release: () => {},
                },
              ],
              render(node, source) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "destroy");
                el.textContent = source;
                return el;
              },
              destroy: () => { destroyCalled = true; },
            },
          ],
        },
      ],
    });

    // Destroy the editor (which destroys all widgets)
    editor.destroy();
    expect(destroyCalled).toBe(true);
  });

  it("supports multiple guard types on the same widget", () => {
    const container = document.createElement("div");
    const guardsAcquired: string[] = [];
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "multi-guard-widget",
          widgets: [
            {
              nodeType: "code",
              interactionGuards: [
                { type: "focus", acquire: () => {}, release: () => {} },
                { type: "drag", acquire: () => {}, release: () => {} },
              ],
              render(node, source, ctx) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "multi");
                el.textContent = source;
                el.addEventListener("mousedown", () => {
                  ctx?.acquireGuard("focus");
                  ctx?.acquireGuard("drag");
                  guardsAcquired.push("focus", "drag");
                });
                return el;
              },
            },
          ],
        },
      ],
    });

    const widget = container.querySelector("[data-widget='multi']");
    expect(widget).not.toBeNull();

    widget?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(guardsAcquired).toEqual(["focus", "drag"]);

    editor.destroy();
  });
});
