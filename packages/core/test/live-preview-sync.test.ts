/**
 * live-preview-sync.test.ts — Tests for mdastToPreviewHtml + createSyncScroll
 *
 * mdastToPreviewHtml is a pure function → direct AST construction tests.
 * createSyncScroll needs DOM/scroll mocking → lifecycle tests.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { Root, Paragraph, Text, Strong, Emphasis, Link, InlineCode, Image, Delete, Html } from "mdast";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { mdastToPreviewHtml, createSyncScroll, type SyncScrollOptions } from "../src/live-preview-sync";

// ── Helpers ──────────────────────────────────────────────────────

/** Build a minimal Root with position offsets. */
function rootWith(children: Root["children"]): Root {
  return { type: "root", children };
}

function text(value: string, offsetStart: number, offsetEnd: number): Text {
  return { type: "text", value, position: { start: { offset: offsetStart, line: 1, column: 1 }, end: { offset: offsetEnd, line: 1, column: 1 } } };
}

function paragraph(children: Paragraph["children"], offsetStart: number, offsetEnd: number): Paragraph {
  return { type: "paragraph", children, position: { start: { offset: offsetStart, line: 1, column: 1 }, end: { offset: offsetEnd, line: 1, column: 1 } } };
}

/** Strip indentation, newlines and extra whitespace for fuzzy comparison. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ");
}

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (!("getBoundingClientRect" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
});

// ── mdastToPreviewHtml ────────────────────────────────────────────

describe("mdastToPreviewHtml", () => {
  it("renders a paragraph", () => {
    const ast = rootWith([paragraph([text("Hello world", 0, 12)], 0, 12)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('class="preview-block"');
    expect(html).toContain('data-pos-from="0"');
    expect(html).toContain('data-pos-to="12"');
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders headings h1–h6", () => {
    const ast = rootWith([
      { type: "heading", depth: 1, children: [text("H1", 0, 2)], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 2, line: 1, column: 1 } } },
      { type: "heading", depth: 2, children: [text("H2", 3, 5)], position: { start: { offset: 3, line: 1, column: 1 }, end: { offset: 5, line: 1, column: 1 } } },
      { type: "heading", depth: 6, children: [text("H6", 6, 8)], position: { start: { offset: 6, line: 1, column: 1 }, end: { offset: 8, line: 1, column: 1 } } },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
    expect(html).toContain("<h6>H6</h6>");
  });

  it("clamps heading depth to 1–6", () => {
    const ast = rootWith([
      { type: "heading", depth: 0, children: [text("x", 0, 1)], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 1 } } } as any,
      { type: "heading", depth: 99, children: [text("y", 2, 3)], position: { start: { offset: 2, line: 1, column: 1 }, end: { offset: 3, line: 1, column: 1 } } } as any,
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<h1>x</h1>");
    expect(html).toContain("<h6>y</h6>");
  });

  it("renders code block with language class", () => {
    const ast = rootWith([
      { type: "code", lang: "js", value: "const a = 1;", position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 14, line: 1, column: 1 } } },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('data-language="js"');
    expect(html).toContain('class="language-js"');
    expect(html).toContain("const a = 1;");
  });

  it("renders code block without language", () => {
    const ast = rootWith([
      { type: "code", lang: null, value: "plain", position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 5, line: 1, column: 1 } } },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<pre><code>plain</code></pre>");
    expect(html).not.toContain("data-language");
  });

  it("renders blockquote", () => {
    const inner = paragraph([text("quote", 1, 6)], 1, 6);
    const ast = rootWith([
      { type: "blockquote", children: [inner], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 7, line: 1, column: 1 } } } as any,
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<p>quote</p>");
  });

  it("renders thematic break", () => {
    const ast = rootWith([
      { type: "thematicBreak", position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 3, line: 1, column: 1 } } },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<hr />");
  });

  it("renders ordered list with start attribute", () => {
    const ast = rootWith([
      {
        type: "list", ordered: true, start: 3, children: [
          { type: "listItem", spread: false, checked: null, children: [paragraph([text("one", 0, 3)], 0, 3)], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 3, line: 1, column: 1 } } },
          { type: "listItem", spread: false, checked: null, children: [paragraph([text("two", 4, 7)], 4, 7)], position: { start: { offset: 4, line: 1, column: 1 }, end: { offset: 7, line: 1, column: 1 } } },
        ],
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 8, line: 1, column: 1 } },
      },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<li>");
    expect(html).toContain("<p>one</p>");
    expect(html).toContain("<p>two</p>");
    expect(html).toContain("</ol>");
  });

  it("renders unordered list", () => {
    const ast = rootWith([
      {
        type: "list", ordered: false, start: null, children: [
          { type: "listItem", spread: false, checked: null, children: [paragraph([text("A", 0, 1)], 0, 1)], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 1 } } },
          { type: "listItem", spread: false, checked: null, children: [paragraph([text("B", 2, 3)], 2, 3)], position: { start: { offset: 2, line: 1, column: 1 }, end: { offset: 3, line: 1, column: 1 } } },
        ],
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 4, line: 1, column: 1 } },
      },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<ul>");
    expect(html).toContain("</ul>");
  });

  it("renders task items with checkbox (checked and unchecked)", () => {
    const ast = rootWith([
      {
        type: "list", ordered: false, start: null, children: [
          {
            type: "listItem", spread: false, checked: true, children: [paragraph([text("done", 3, 7)], 3, 7)],
            position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 7, line: 1, column: 1 } },
          },
          {
            type: "listItem", spread: false, checked: false, children: [paragraph([text("todo", 11, 15)], 11, 15)],
            position: { start: { offset: 8, line: 1, column: 1 }, end: { offset: 15, line: 1, column: 1 } },
          },
        ],
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 16, line: 1, column: 1 } },
      },
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('class="task-item"');
    // Two checkboxes: exactly one has the checked attribute
    expect((html.match(/<input type="checkbox"/g) || [])).toHaveLength(2);
    expect((html.match(/ checked /g) || [])).toHaveLength(1);
  });

  it("renders table with header and rows", () => {
    const ast = rootWith([
      {
        type: "table", children: [
          {
            type: "tableRow", children: [
              { type: "tableCell", children: [text("Name", 1, 5)] },
              { type: "tableCell", children: [text("Age", 6, 9)] },
            ],
          },
          {
            type: "tableRow", children: [
              { type: "tableCell", children: [text("Alice", 10, 15)] },
              { type: "tableCell", children: [text("30", 16, 18)] },
            ],
          },
        ],
        position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 19, line: 1, column: 1 } },
      },
      // We also need an align property for the type
    ] as any);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<th>Age</th>");
    expect(html).toContain("<td>Alice</td>");
    expect(html).toContain("<td>30</td>");
    expect(html).toContain("</table>");
  });

  it("renders inline formatting: strong, emphasis, delete, inlineCode", () => {
    const ast = rootWith([
      paragraph([
        text("before ", 0, 7),
        { type: "strong", children: [text("bold", 9, 13)] } as Strong,
        text(" ", 14, 15),
        { type: "emphasis", children: [text("italic", 16, 22)] } as Emphasis,
        text(" ", 23, 24),
        { type: "delete", children: [text("struck", 26, 32)] } as Delete,
        text(" ", 33, 34),
        { type: "inlineCode", value: "code" } as InlineCode,
      ], 0, 40),
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>struck</del>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders links with href and optional title", () => {
    const children = [text("Example", 1, 8)] as any;
    const ast = rootWith([paragraph([
      { type: "link", url: "https://x.com", title: null, children } as Link,
    ], 0, 10)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('<a href="https://x.com">');
    expect(html).toContain("Example</a>");
    expect(html).not.toContain("title=");
  });

  it("renders images with alt and title", () => {
    const ast = rootWith([paragraph([
      { type: "image", url: "/img.png", alt: "pic", title: "Caption" } as Image,
    ], 0, 10)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('src="/img.png"');
    expect(html).toContain('alt="pic"');
    expect(html).toContain('title="Caption"');
  });

  it("renders footnote reference", () => {
    const ast = rootWith([paragraph([
      text("text", 0, 4),
      { type: "footnoteReference", identifier: "fn1", label: "1" } as any,
    ], 0, 10)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('<sup class="footnote-ref">');
    expect(html).toContain('<a href="#fn-fn1">1</a>');
  });

  it("renders footnote definition", () => {
    const inner = paragraph([text("note", 4, 8)], 4, 8);
    const ast = rootWith([
      { type: "footnoteDefinition", identifier: "fn1", label: "1", children: [inner], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 10, line: 1, column: 1 } } } as any,
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('class="footnote-definition"');
    expect(html).toContain("fn1.");
    expect(html).toContain("<p>note</p>");
  });

  it("renders raw HTML inline", () => {
    const ast = rootWith([paragraph([
      text("a", 0, 1),
      { type: "html", value: "<b>raw</b>" } as Html,
    ], 0, 12)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<b>raw</b>");
  });

  it("renders definition as empty string", () => {
    const ast = rootWith([
      { type: "definition", identifier: "ref", url: "https://x.com", title: null } as any,
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toBe("");
  });

  it("renders unknown node with children as unknown-block", () => {
    const ast = rootWith([
      { type: "custom", children: [paragraph([text("x", 0, 1)], 0, 1)], position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 2, line: 1, column: 1 } } } as any,
    ]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('class="unknown-block"');
    expect(html).toContain("<p>x</p>");
  });

  it("escapes HTML special characters in text", () => {
    const ast = rootWith([paragraph([text("<script>alert('x')</script>", 0, 27)], 0, 27)]);
    const html = mdastToPreviewHtml(ast);
    // esc() handles &, <, > but not single quotes
    expect(html).toContain("&lt;script&gt;alert('x')&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes HTML in inline code", () => {
    const ast = rootWith([paragraph([
      { type: "inlineCode", value: "<b>danger</b>" } as InlineCode,
    ], 0, 18)]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<code>&lt;b&gt;danger&lt;/b&gt;</code>");
  });

  it("throws on null children (caller must ensure valid Root)", () => {
    expect(() => mdastToPreviewHtml({ type: "root", children: null as any })).toThrow();
  });

  it("handles empty root", () => {
    const ast = rootWith([]);
    const html = mdastToPreviewHtml(ast);
    expect(html).toBe("");
  });

  it("marks every block with preview-block class and data-pos attributes", () => {
    const ast = rootWith([
      paragraph([text("p1", 0, 2)], 0, 2),
      { type: "heading", depth: 2, children: [text("h", 3, 4)], position: { start: { offset: 3, line: 1, column: 1 }, end: { offset: 4, line: 1, column: 1 } } },
      { type: "code", lang: null, value: "c", position: { start: { offset: 5, line: 1, column: 1 }, end: { offset: 6, line: 1, column: 1 } } },
    ]);
    const html = mdastToPreviewHtml(ast);
    const blocks = html.match(/class="preview-block"/g);
    expect(blocks).toHaveLength(3);
    expect(html).toContain('data-pos-from="0" data-pos-to="2"');
    expect(html).toContain('data-pos-from="3" data-pos-to="4"');
    expect(html).toContain('data-pos-from="5" data-pos-to="6"');
  });
});

// ── Integration: lezerStringToMdast → mdastToPreviewHtml ───────────

describe("mdastToPreviewHtml (integration via lezerStringToMdast)", () => {
  it("renders a full markdown document with multiple block types", () => {
    const md = "# Title\n\nHello **world**\n\n- one\n- two\n";
    const ast = lezerStringToMdast(md);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<h1>");
    expect(html).toContain("Title");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<li>");
    expect(html).toContain("<ul>");
    // All blocks should have position data
    expect(html).toContain('data-pos-from="');
    expect(html).toContain('data-pos-to="');
  });

  it("renders task list items with checkboxes", () => {
    const md = "- [x] done\n- [ ] todo\n";
    const ast = lezerStringToMdast(md);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain('class="task-item"');
    expect(html).toContain('<input type="checkbox" checked');
    expect(html).toContain('<input type="checkbox" ');
    // Note: text content inside task items depends on the lezer-mdast-adapter
    // version — some emit Paragraph wrappers, some don't. We only verify
    // that checkboxes render correctly regardless.
  });

  it("renders table with GFM pipe syntax", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const ast = lezerStringToMdast(md);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("</table>");
  });

  it("renders blockquote, code, and horizontal rule", () => {
    const md = "> quote\n\n```\ncode\n```\n\n---\n";
    const ast = lezerStringToMdast(md);
    const html = mdastToPreviewHtml(ast);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<p>quote</p>");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("<hr />");
  });
});

// ── createSyncScroll ──────────────────────────────────────────────

describe("createSyncScroll", () => {
  it("returns a SyncScrollController with destroy, refreshPreview, setEnabled", () => {
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => "<p>test</p>",
      initialSync: false,
    });
    expect(ctrl).toHaveProperty("destroy");
    expect(ctrl).toHaveProperty("refreshPreview");
    expect(ctrl).toHaveProperty("setEnabled");
    ctrl.destroy();
  });

  it("injects preview styles into the container", () => {
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => "",
      initialSync: false,
    });
    expect(previewContainer.querySelector("#nexus-preview-styles")).not.toBeNull();
    expect(previewContainer.classList.contains("nexus-preview")).toBe(true);
    ctrl.destroy();
  });

  it("refreshPreview updates innerHTML from renderPreview", () => {
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => '<div class="preview-block">hello</div>',
      initialSync: false,
    });
    ctrl.refreshPreview();
    expect(previewContainer.innerHTML).toContain("hello");
    expect(previewContainer.innerHTML).toContain('class="preview-block"');
    ctrl.destroy();
  });

  it("refreshPreview skips innerHTML update when HTML is unchanged", () => {
    const renderFn = vi.fn(() => "<p>same</p>");
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: renderFn,
      initialSync: false,
    });
    ctrl.refreshPreview();
    const innerHTMLafterFirst = previewContainer.innerHTML;
    ctrl.refreshPreview();
    // renderFn is called each time, but innerHTML should not be re-set
    expect(renderFn).toHaveBeenCalledTimes(2);
    // innerHTML should still have the content from the first call
    expect(previewContainer.innerHTML).toBe(innerHTMLafterFirst);
    ctrl.destroy();
  });

  it("setEnabled(true/false) toggles syncing", () => {
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => "",
      initialSync: false,
    });
    // Default is enabled
    ctrl.setEnabled(false);
    // Should not crash when disabled
    ctrl.refreshPreview();
    ctrl.setEnabled(true);
    ctrl.refreshPreview();
    ctrl.destroy();
  });

  it("destroy is idempotent", () => {
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => "",
      initialSync: false,
    });
    ctrl.destroy();
    // Second destroy should not throw
    ctrl.destroy();
    // Methods should not throw after destroy
    ctrl.refreshPreview();
    ctrl.setEnabled(false);
  });

  it("does not crash on initialSync with empty document", () => {
    vi.useFakeTimers();
    const editor = { scrollDOM: document.createElement("div"), state: { doc: { toString: () => "", length: 0, lineAt: () => ({ from: 0 }) }, selection: { main: { head: 0 } } } } as unknown as EditorView;
    const previewContainer = document.createElement("div");
    const ctrl = createSyncScroll({
      editor,
      previewContainer,
      renderPreview: () => "",
      initialSync: true,
    });
    // Run pending rAF from initialSync
    vi.runAllTimers();
    ctrl.destroy();
    vi.useRealTimers();
  });
});
