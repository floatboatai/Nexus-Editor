import { describe, expect, it } from "vitest";
import { htmlToMarkdown, isRichHtml } from "../src/html-to-markdown";
import { createEditor } from "../src/editor";

describe("htmlToMarkdown", () => {
  it("detects rich HTML accurately", () => {
    expect(isRichHtml("<p>Hello world</p>")).toBe(true);
    expect(isRichHtml("<h1>Title</h1>")).toBe(true);
    expect(isRichHtml("<b>Bold</b>")).toBe(true);
    expect(isRichHtml("<table><tr><td>Cell</td></tr></table>")).toBe(true);
    expect(isRichHtml("plain text only")).toBe(false);
    expect(isRichHtml("")).toBe(false);
  });

  it("converts headings, paragraphs and line breaks", () => {
    const html = "<h1>Heading 1</h1><p>First paragraph<br>second line</p><h2>Heading 2</h2>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Heading 1");
    expect(md).toContain("First paragraph\nsecond line");
    expect(md).toContain("## Heading 2");
  });

  it("converts basic inline styling (bold, italic, strikethrough, code)", () => {
    const html = "<p><strong>Bold</strong>, <em>italic</em>, <del>deleted</del>, and <code>code</code>.</p>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("**Bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("~~deleted~~");
    expect(md).toContain("`code`");
  });

  it("converts links and images", () => {
    const html = '<p><a href="https://example.com">Example</a> and <img src="image.png" alt="Test Logo" /></p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("[Example](https://example.com)");
    expect(md).toContain("![Test Logo](image.png)");
  });

  it("converts unordered and ordered lists", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>Step 1</li><li>Step 2</li></ol>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
    expect(md).toContain("1. Step 1");
    expect(md).toContain("2. Step 2");
  });

  it("converts code blocks with optional language tags", () => {
    const html = '<pre><code class="language-typescript">const x: number = 42;</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x: number = 42;");
    expect(md).toContain("```");
  });

  it("converts blockquotes", () => {
    const html = "<blockquote><p>Quote line 1</p><p>Quote line 2</p></blockquote>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("> Quote line 1");
    expect(md).toContain("> Quote line 2");
  });

  it("converts HTML tables to standard GFM markdown tables", () => {
    const html = `
      <table>
        <thead>
          <tr><th>Col A</th><th>Col B</th></tr>
        </thead>
        <tbody>
          <tr><td>Val 1</td><td>Val 2</td></tr>
        </tbody>
      </table>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("| Col A | Col B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Val 1 | Val 2 |");
  });
});

describe("smart paste in editor", () => {
  it("automatically converts pasted rich text HTML to clean markdown", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });
    const content = container.querySelector(".cm-content");

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as any;
    pasteEvent.clipboardData = {
      getData(format: string) {
        if (format === "text/html") {
          return "<h3>Copied Subtitle</h3><p>Here is <strong>bold text</strong> from web.</p>";
        }
        return "Copied Subtitle Here is bold text from web.";
      }
    };

    content?.dispatchEvent(pasteEvent);

    const doc = editor.getDocument();
    expect(doc).toContain("### Copied Subtitle");
    expect(doc).toContain("**bold text**");

    editor.destroy();
  });
});
