import { describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/editor";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { exportStandaloneHTML, exportWordDocument, printDocument } from "../src/export";

describe("document export system", () => {
  it("exports standalone HTML with standard typography and print stylesheets", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Export Title\n\nParagraph text with **bold** and a [link](https://example.com).",
    });

    const html = editor.exportStandaloneHTML({ title: "Custom Title" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Custom Title</title>");
    expect(html).toContain("<h1>Export Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("@media print");

    editor.destroy();
  });

  it("exports Microsoft Word compatible document", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Report\n\n| Item | Value |\n| --- | --- |\n| A | 100 |",
      plugins: [createGfmPreset()],
    });

    const wordDoc = editor.exportWord({ title: "Quarterly Report" });

    expect(wordDoc).toContain("xmlns:w='urn:schemas-microsoft-com:office:word'");
    expect(wordDoc).toContain("<title>Quarterly Report</title>");
    expect(wordDoc).toContain("Report");
    expect(wordDoc).toContain("<table>");

    editor.destroy();
  });

  it("triggers print mechanism for document", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Printable Note",
    });

    const writeSpy = vi.fn();
    const printSpy = vi.fn();

    // Verify print method runs without throwing
    expect(() => editor.print({ title: "Print Test" })).not.toThrow();

    editor.destroy();
  });
});
