import { describe, expect, it, vi } from "vitest";

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
    const md = ["before", "", "```mermaid", "graph TD", "  A --> B", "```", "", "after"].join("\n");

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

    // Edit button should be present.
    const editBtn = host?.querySelector("button");
    expect(editBtn).not.toBeNull();

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

    const editBtn = container.querySelector(".nexus-mermaid button") as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();

    editBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const { anchor } = editor.getSelection();
    const blockStart = md.indexOf("```mermaid");
    const firstContentLine = md.indexOf("\n", blockStart) + 1;
    // Cursor should be on the first content line of the block ("graph TD").
    expect(anchor).toBe(firstContentLine);

    editor.destroy();
  });
});
