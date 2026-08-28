import { describe, expect, it, vi } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";

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

describe("mermaid live preview", () => {
  it("replaces ```mermaid blocks with a diagram widget when cursor is outside", () => {
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
    });

    // Cursor parked on the last line, outside the mermaid block.
    editor.setSelection(editor.getDocument().length);

    const host = container.querySelector(".nexus-mermaid") as HTMLElement | null;
    expect(host).not.toBeNull();

    // Source text must be gone (replaced by widget).
    const visibleText = container.textContent ?? "";
    expect(visibleText).not.toContain("graph TD");
    expect(visibleText).not.toContain("```mermaid");

    const editBtn = host?.querySelector(".nexus-mermaid-edit") as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();
    expect(editBtn?.textContent).toContain("Edit");
    const chrome = host?.querySelector(".nexus-mermaid-chrome");
    expect(chrome?.contains(editBtn!)).toBe(true);

    editor.destroy();
  });

  it("falls back to editable source when cursor is inside the mermaid block", () => {
    const container = makeContainer();
    const md = "```mermaid\ngraph TD\n  A --> B\n```\n\nend";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // Move cursor inside the block (into "graph TD" line).
    const insidePos = md.indexOf("graph TD") + 2;
    editor.setSelection(insidePos);

    // Widget is NOT emitted while cursor is inside.
    expect(container.querySelector(".nexus-mermaid")).toBeNull();

    // Source text is visible & editable (shown as fenced code).
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
    });

    editor.setSelection(editor.getDocument().length);

    expect(container.querySelector(".nexus-mermaid")).toBeNull();
    expect(container.textContent).toContain("const x = 1;");

    editor.destroy();
  });

  it("clicking the edit icon moves the cursor into the mermaid source", () => {
    const container = makeContainer();
    const md = "before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    // Cursor outside the block.
    editor.setSelection(editor.getDocument().length);

    const editBtn = container.querySelector(".nexus-mermaid-edit") as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();

    editBtn!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    const { anchor } = editor.getSelection();
    const blockStart = md.indexOf("```mermaid");
    const firstContentLine = md.indexOf("\n", blockStart) + 1;
    // Cursor should be on the first content line of the block ("graph TD").
    expect(anchor).toBe(firstContentLine);
    expect(container.querySelector(".nexus-mermaid")).toBeNull();
    expect(container.textContent).toContain("graph TD");

    editor.destroy();
  });

  it("clicking the diagram body reveals mermaid source", () => {
    const container = makeContainer();
    const md = "before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter";

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });

    editor.setSelection(editor.getDocument().length);

    const host = container.querySelector(".nexus-mermaid") as HTMLElement | null;
    expect(host).not.toBeNull();

    host!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(container.querySelector(".nexus-mermaid")).toBeNull();
    expect(container.textContent).toContain("graph TD");
    expect(container.textContent).toContain("```mermaid");

    editor.destroy();
  });

  it("reveals mermaid source even when a table range lock is held", () => {
    const container = makeContainer();
    const md = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");

    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    const cells = container.querySelectorAll<HTMLElement>("tr")[2]
      ?.querySelectorAll<HTMLElement>(".nexus-cell");
    const firstCell = cells?.[0];
    const secondCell = cells?.[1];
    expect(firstCell).not.toBeUndefined();
    expect(secondCell).not.toBeUndefined();
    firstCell!.getBoundingClientRect = () => new DOMRect(0, 0, 50, 30);
    secondCell!.getBoundingClientRect = () => new DOMRect(50, 0, 50, 30);

    firstCell!.dispatchEvent(new MouseEvent("mousedown", {
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

    expect(editor.getContributionSink().isInteractionActive()).toBe(true);
    const host = container.querySelector(".nexus-mermaid") as HTMLElement | null;
    expect(host).not.toBeNull();

    host!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));

    expect(container.querySelector(".nexus-mermaid")).toBeNull();
    expect(container.textContent).toContain("graph TD");
    expect(editor.getContributionSink().isInteractionActive()).toBe(false);

    editor.destroy();
  });
});
