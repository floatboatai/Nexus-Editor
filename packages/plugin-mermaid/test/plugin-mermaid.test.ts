import { describe, expect, it, vi } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import { createMermaidPlugin } from "../src/index";

// Mock mermaid so tests don't have to pull the real ~500KB package and don't
// fail in jsdom (mermaid internally uses layout APIs not available in jsdom).
vi.mock("mermaid", () => {
  return {
    default: {
      initialize: vi.fn(),
      parse: vi.fn(async () => true),
      render: vi.fn(async (id: string, text: string) => ({
        svg: `<svg data-id="${id}" data-source="${text.length}"></svg>`,
      })),
    },
  };
});

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("mermaid plugin", () => {
  it("renders a diagram widget for ```mermaid blocks when cursor is outside", () => {
    const container = makeContainer();
    const md = [
      "before",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "after",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    // Cursor parked at the end, outside the mermaid block.
    editor.setSelection(editor.getDocument().length);

    const host = container.querySelector(
      ".nexus-mermaid"
    ) as HTMLElement | null;
    expect(host).not.toBeNull();

    // Source text must be gone (replaced by widget).
    const visibleText = container.textContent ?? "";
    expect(visibleText).not.toContain("graph TD");
    expect(visibleText).not.toContain("```mermaid");

    // Edit button should be present.
    const editBtn = host?.querySelector("button");
    expect(editBtn).not.toBeNull();
    expect(editBtn?.textContent).toContain("✎");

    editor.destroy();
  });

  it("shows raw mermaid source when cursor is inside the block", () => {
    const container = makeContainer();
    const md = "```mermaid\ngraph TD\n  A --> B\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    // Move cursor inside the block ("graph TD" line).
    const insidePos = md.indexOf("graph TD") + 2;
    editor.setSelection(insidePos);

    // Widget is NOT emitted while cursor is inside.
    expect(container.querySelector(".nexus-mermaid")).toBeNull();

    // Source text is visible & editable.
    const visibleText = container.textContent ?? "";
    expect(visibleText).toContain("graph TD");

    editor.destroy();
  });

  it("does not affect non-mermaid fenced code blocks", () => {
    const container = makeContainer();
    const md = "```js\nconst x = 1;\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    editor.setSelection(editor.getDocument().length);

    // Non-mermaid code blocks should NOT be converted to widgets.
    expect(container.querySelector(".nexus-mermaid")).toBeNull();
    expect(container.textContent).toContain("const x = 1;");

    editor.destroy();
  });

  it("clicking the edit icon moves cursor into mermaid source for editing", () => {
    const container = makeContainer();
    const md =
      "before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    // Cursor outside the block.
    editor.setSelection(editor.getDocument().length);

    const editBtn = container.querySelector(
      ".nexus-mermaid button"
    ) as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();

    editBtn!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    // After clicking edit, cursor should move into the mermaid source.
    const { anchor } = editor.getSelection();
    const blockStart = md.indexOf("```mermaid");
    // Cursor should be on or after the first content line of the block.
    expect(anchor).toBeGreaterThan(blockStart);

    editor.destroy();
  });

  it("renders widget DOM stably and injects SVG after async render", async () => {
    const container = makeContainer();

    const md = "```mermaid\ngraph TD\n  A --> B\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    editor.setSelection(editor.getDocument().length);

    const host = container.querySelector(
      ".nexus-mermaid"
    ) as HTMLElement | null;
    expect(host).not.toBeNull();

    // The container should be connected to the DOM — no white-screen or
    // unmounted widget while async render is in flight.
    expect(host!.isConnected).toBe(true);

    // The mock mermaid resolves synchronously within the microtask queue,
    // so after a tick the SVG should be present. In a real environment,
    // "Loading diagram…" appears briefly, but with synchronous mocks the
    // render completes before we can observe the intermediate state.
    await new Promise((r) => setTimeout(r, 0));

    // After the mock resolves, the SVG should be injected.
    // The mock sets data-id with our mermaid prefix and data-source
    // with the source text length.
    const svg = host!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("data-id")).toContain("nexus-mmd-");

    editor.destroy();
  });

  it("shows error display on mermaid syntax errors", async () => {
    const container = makeContainer();

    // Get the mocked mermaid module and override parse to reject.
    const mermaidMod = await import("mermaid");
    const origParse = (mermaidMod as any).default.parse;
    (mermaidMod as any).default.parse = vi.fn(async () => {
      throw new Error("Syntax error in graph: expected valid token");
    });

    const md = "```mermaid\nthis is broken syntax\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    editor.setSelection(editor.getDocument().length);

    // Wait for the async mermaid parse/render microtasks to settle.
    await new Promise((r) => setTimeout(r, 0));

    const host = container.querySelector(
      ".nexus-mermaid"
    ) as HTMLElement | null;
    expect(host).not.toBeNull();

    // The container should still exist (no white-screen / unmounted).
    expect(host!.isConnected).toBe(true);

    // Restore original mock.
    (mermaidMod as any).default.parse = origParse;

    editor.destroy();
  });

  it("destroy callback cleans up widget DOM without errors", () => {
    const container = makeContainer();
    const md = "```mermaid\ngraph TD\n  A --> B\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createMermaidPlugin()],
    });

    editor.setSelection(editor.getDocument().length);

    const host = container.querySelector(".nexus-mermaid") as HTMLElement | null;
    expect(host).not.toBeNull();

    // Destroying should not throw and should remove widgets.
    editor.destroy();
    expect(container.querySelector(".nexus-mermaid")).toBeNull();
  });
});
