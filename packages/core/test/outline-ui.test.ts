import { describe, expect, it } from "vitest";
import { createEditor } from "../src/editor";
import { createOutlineUI } from "../src/outline-ui";

describe("createOutlineUI", () => {
  it("renders empty state when there are no headings", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Just some text without headings." });
    const outline = createOutlineUI(editor);

    expect(outline.element).toBeDefined();
    expect(outline.element.querySelector(".nexus-outline-empty")?.textContent).toBe(
      "No headings in document"
    );

    outline.destroy();
    editor.destroy();
  });

  it("renders hierarchical outline items from document headings", () => {
    const container = document.createElement("div");
    const markdown = `# Title 1
Paragraph text

## Subtitle 1.1
More text

### Section 1.1.1
Deep text

# Title 2`;

    const editor = createEditor({ container, initialValue: markdown });
    const outline = createOutlineUI(editor);

    const items = outline.element.querySelectorAll(".nexus-outline-item");
    expect(items.length).toBe(4);

    expect(items[0]?.textContent).toBe("Title 1");
    expect((items[0] as HTMLElement).dataset.level).toBe("1");

    expect(items[1]?.textContent).toBe("Subtitle 1.1");
    expect((items[1] as HTMLElement).dataset.level).toBe("2");

    expect(items[2]?.textContent).toBe("Section 1.1.1");
    expect((items[2] as HTMLElement).dataset.level).toBe("3");

    expect(items[3]?.textContent).toBe("Title 2");
    expect((items[3] as HTMLElement).dataset.level).toBe("1");

    outline.destroy();
    editor.destroy();
  });

  it("navigates editor selection when clicking an outline item", () => {
    const container = document.createElement("div");
    const markdown = `# First Heading\nSome content\n\n## Target Heading\nTarget content`;
    const editor = createEditor({ container, initialValue: markdown });
    const outline = createOutlineUI(editor);

    const items = outline.element.querySelectorAll<HTMLButtonElement>(".nexus-outline-item");
    expect(items.length).toBe(2);

    items[1]?.click();

    const sel = editor.getSelection();
    expect(sel.anchor).toBe(markdown.indexOf("## Target Heading"));

    outline.destroy();
    editor.destroy();
  });

  it("automatically updates outline items when document content changes", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Heading A" });
    const outline = createOutlineUI(editor);

    expect(outline.element.querySelectorAll(".nexus-outline-item").length).toBe(1);

    editor.setDocument("# Heading A\n\n## Heading B\n\n### Heading C");

    const updatedItems = outline.element.querySelectorAll(".nexus-outline-item");
    expect(updatedItems.length).toBe(3);
    expect(updatedItems[1]?.textContent).toBe("Heading B");

    outline.destroy();
    editor.destroy();
  });
});
