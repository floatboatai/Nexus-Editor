import { describe, expect, it } from "vitest";

import {
  htmlToMarkdown,
  isSafeHref,
  isSafeImgSrc,
  markdownFromClipboard,
} from "../src/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, and emphasis", () => {
    const html = "<h1>Title</h1><p>Hello <strong>world</strong> and <em>friends</em>.</p>";
    expect(htmlToMarkdown(html)).toBe("# Title\n\nHello **world** and *friends*.");
  });

  it("converts links and images with safe URLs", () => {
    expect(htmlToMarkdown('<p><a href="https://ex.com">click</a></p>')).toBe("[click](https://ex.com)");
    expect(htmlToMarkdown('<p><img src="https://ex.com/a.png" alt="cat"></p>')).toBe("![cat](https://ex.com/a.png)");
  });

  it("drops javascript hrefs but keeps the link text", () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe("click");
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).not.toContain("javascript:");
  });

  it("converts nested unordered lists", () => {
    const html = "<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>";
    expect(htmlToMarkdown(html)).toBe("- one\n  - nested\n- two");
  });

  it("converts ordered lists with 1-based numbering", () => {
    expect(htmlToMarkdown("<ol><li>alpha</li><li>beta</li></ol>")).toBe("1. alpha\n2. beta");
  });

  it("converts task list checkboxes", () => {
    const html = '<ul><li><input type="checkbox"> todo</li><li><input type="checkbox" checked> done</li></ul>';
    expect(htmlToMarkdown(html)).toBe("- [ ] todo\n- [x] done");
  });

  it("converts blockquotes, thematic breaks, and fenced code", () => {
    const html = "<blockquote><p>quote</p></blockquote><hr><pre><code class=\"language-ts\">const x = 1;</code></pre>";
    expect(htmlToMarkdown(html)).toBe("> quote\n\n---\n\n```ts\nconst x = 1;\n```");
  });

  it("converts GFM tables and escapes pipes in cells", () => {
    const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1|2</td><td>3</td></tr></table>";
    expect(htmlToMarkdown(html)).toBe("| A | B |\n| --- | --- |\n| 1\\|2 | 3 |");
  });

  it("unwraps Google Docs no-op bold wrappers and honours style-attribute emphasis", () => {
    const html =
      '<b style="font-weight:normal" id="docs-internal-guid-x"><span style="font-weight:700">Bold</span> and <span style="font-style:italic">italic</span></b>';
    expect(htmlToMarkdown(html)).toBe("**Bold** and *italic*");
  });

  it("ignores script and style tags", () => {
    expect(htmlToMarkdown("<p>ok</p><script>alert(1)</script><style>p{}</style>")).toBe("ok");
  });

  it("returns an empty string for blank input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });
});

describe("markdownFromClipboard", () => {
  it("returns heading markdown when HTML is richer than plain text", () => {
    expect(markdownFromClipboard("<h1>Title</h1>", "Title")).toBe("# Title");
  });

  it("returns null when HTML is just a wrapped copy of the plain text", () => {
    expect(markdownFromClipboard("<p>hello</p>", "hello")).toBeNull();
  });

  it("returns null for empty or non-convertible HTML", () => {
    expect(markdownFromClipboard("", "hello")).toBeNull();
    expect(markdownFromClipboard("<div></div>", "")).toBeNull();
  });
});

describe("URL sanitizers", () => {
  it("accepts http(s), mailto, and relative hrefs", () => {
    expect(isSafeHref("https://ex.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.c")).toBe(true);
    expect(isSafeHref("/notes/a.md")).toBe(true);
    expect(isSafeHref("#heading")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,hi")).toBe(false);
  });

  it("allows http and data:image sources on images", () => {
    expect(isSafeImgSrc("https://ex.com/a.png")).toBe(true);
    expect(isSafeImgSrc("data:image/png;base64,xx")).toBe(true);
    expect(isSafeImgSrc("data:text/html,x")).toBe(false);
    expect(isSafeImgSrc("javascript:x")).toBe(false);
  });
});
