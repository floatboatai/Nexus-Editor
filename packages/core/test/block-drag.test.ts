import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { findBlockRange, blockDragExtension } from "../src/block-drag";
import { createEditor } from "../src/editor";

describe("findBlockRange", () => {
  it("detects heading blocks accurately", () => {
    const doc = Text.of(["# Heading 1", "", "Paragraph content"]);
    const block = findBlockRange(doc, 2); // on '# Heading 1'
    expect(block.lineStart).toBe(1);
    expect(block.lineEnd).toBe(1);
    expect(doc.sliceString(block.from, block.to).trim()).toBe("# Heading 1");
  });

  it("detects fenced code blocks including all lines between fences", () => {
    const doc = Text.of([
      "Intro text",
      "```typescript",
      "const a = 1;",
      "const b = 2;",
      "```",
      "Outro text",
    ]);
    const block = findBlockRange(doc, doc.line(3).from); // inside code block
    expect(block.lineStart).toBe(2);
    expect(block.lineEnd).toBe(5);
    const content = doc.sliceString(block.from, block.to);
    expect(content).toContain("```typescript");
    expect(content).toContain("const b = 2;");
  });

  it("detects table blocks across all contiguous pipe rows", () => {
    const doc = Text.of([
      "Before table",
      "| Col A | Col B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "After table",
    ]);
    const block = findBlockRange(doc, doc.line(3).from); // on delimiter row
    expect(block.lineStart).toBe(2);
    expect(block.lineEnd).toBe(4);
    const tableText = doc.sliceString(block.from, block.to);
    expect(tableText).toContain("| Col A | Col B |");
    expect(tableText).toContain("| 1 | 2 |");
  });

  it("detects contiguous paragraph blocks", () => {
    const doc = Text.of([
      "Line 1 of paragraph",
      "Line 2 of paragraph",
      "",
      "Second paragraph",
    ]);
    const block = findBlockRange(doc, doc.line(1).from);
    expect(block.lineStart).toBe(1);
    expect(block.lineEnd).toBe(2);
  });
});

describe("blockDragExtension in editor", () => {
  it("initializes without error and mounts handle and indicator into editor DOM", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\n\nParagraph 1\n\nParagraph 2",
      plugins: [
        {
          name: "block-drag-plugin",
          cmExtensions: [blockDragExtension()],
        },
      ],
    });

    const handle = container.querySelector('[data-test-id="nexus-block-handle"]');
    const indicator = container.querySelector('[data-test-id="nexus-drop-indicator"]');

    expect(handle).not.toBeNull();
    expect(indicator).not.toBeNull();

    editor.destroy();
  });
});
