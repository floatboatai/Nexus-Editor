import { describe, expect, it } from "vitest";

import {
  analyseProse,
  computeDocumentStats,
  countLines,
  stripMarkdownNoise,
} from "../src/document-stats";

describe("computeDocumentStats", () => {
  it("returns zeros for an empty document", () => {
    expect(computeDocumentStats("")).toEqual({ characters: 0, words: 0, lines: 0 });
  });

  it("counts plain English prose", () => {
    expect(computeDocumentStats("Hello, World!")).toEqual({
      characters: 13,
      words: 2,
      lines: 1,
    });
  });

  it("counts numbers as a single word", () => {
    expect(computeDocumentStats("There are 42 lights.").words).toBe(4);
  });

  it("treats apostrophes as part of the same word", () => {
    expect(computeDocumentStats("Don\u2019t can't won't").words).toBe(3);
  });

  it("counts CJK prose per character, not as one whitespace-delimited word", () => {
    const stats = computeDocumentStats("你好世界");
    expect(stats.words).toBe(4);
    expect(stats.characters).toBe(4);
  });

  it("counts mixed CJK + Latin prose without merging the two scripts", () => {
    const stats = computeDocumentStats("Hello 世界");
    expect(stats.words).toBe(3); // 1 Latin word + 2 CJK characters
    expect(stats.characters).toBe(8);
  });

  it("counts emoji by code point, not UTF-16 code unit", () => {
    const stats = computeDocumentStats("😀😀");
    expect(stats.characters).toBe(2);
    expect(stats.words).toBe(0);
  });

  it("reports zero words for punctuation-only documents", () => {
    expect(computeDocumentStats("!!! ？？？").words).toBe(0);
  });

  it("excludes fenced code blocks", () => {
    const stats = computeDocumentStats("text\n\n```js\nconst x = 1;\n```\n");
    expect(stats.words).toBe(1);
    expect(stats.lines).toBe(5);
  });

  it("excludes inline code", () => {
    expect(computeDocumentStats("`abc def` ghi").words).toBe(1);
  });

  it("excludes frontmatter", () => {
    const stats = computeDocumentStats("---\ntitle: Hello World\ntags: [a, b]\n---\n\nBody text");
    expect(stats.words).toBe(2);
  });

  it("excludes HTML tags and comments", () => {
    expect(computeDocumentStats("text <!-- secret words --> <div>hi</div>").words).toBe(2);
  });

  it("excludes math spans and blocks", () => {
    expect(computeDocumentStats("$e^{i\\pi}$ plus $$\\sum_{n=1}^{\\infty} n$$ text").words).toBe(2);
  });

  it("excludes link definitions", () => {
    const stats = computeDocumentStats("[ref]: https://example.com \"a title\"\n\nSee [ref] here.");
    expect(stats.words).toBe(3);
  });

  it("matches CodeMirror line counting (trailing newline adds no line)", () => {
    expect(computeDocumentStats("a\nb\n").lines).toBe(2);
    expect(computeDocumentStats("a\nb").lines).toBe(2);
    expect(computeDocumentStats("a").lines).toBe(1);
  });
});

describe("analyseProse", () => {
  it("counts CJK per character by default", () => {
    const result = analyseProse("你好世界", "char");
    expect(result.words).toBe(4);
    expect(result.cjkCharacters).toBe(4);
    expect(result.latinWords).toBe(0);
  });

  it("counts CJK per run when cjkUnit is 'word'", () => {
    const result = analyseProse("你好世界", "word");
    expect(result.words).toBe(1);
    expect(result.cjkCharacters).toBe(4);
  });

  it("keeps Latin and CJK buckets disjoint", () => {
    const result = analyseProse("Hello世界world", "char");
    expect(result.words).toBe(4); // 2 Latin + 2 CJK
    expect(result.latinWords).toBe(2);
    expect(result.cjkCharacters).toBe(2);
  });

  it("counts characters without whitespace", () => {
    const result = analyseProse("a b c", "char");
    expect(result.characters).toBe(5);
    expect(result.charactersNoSpaces).toBe(3);
  });
});

describe("stripMarkdownNoise", () => {
  it("strips fenced code, inline code, and HTML in one pass", () => {
    const stripped = stripMarkdownNoise("`x` ```code``` <b>y</b>");
    expect(stripped.trim()).toBe("y");
  });

  // The following edge cases document behaviour that is intentionally
  // identical to the pre-refactor wordcount implementation: the strip
  // pass is a best-effort heuristic, and the core + wordcount APIs must
  // keep answering the same way.

  it("leaves a lone dollar sign (price) untouched", () => {
    expect(stripMarkdownNoise("It costs $5.99")).toContain("$5.99");
  });

  it("does not match `---` unless a full frontmatter block is present", () => {
    expect(stripMarkdownNoise("text\n---\nmore")).toContain("---");
    // A complete frontmatter block is stripped even mid-document.
    const stripped = stripMarkdownNoise("a\n---\ntitle: x\n---\nb");
    expect(stripped).not.toContain("title: x");
  });

  it("strips a paired backtick span that crosses newlines (wordcount-compatible)", () => {
    // `[^`]*` spans newlines, so a matched pair swallows the whole
    // multi-line span. Unpaired backticks are left untouched. This is
    // the pre-existing wordcount behaviour and is kept so the two APIs
    // stay identical.
    expect(stripMarkdownNoise("a `code\nmore` b")).toBe("a   b"); // a + sep + sep + b
    expect(stripMarkdownNoise("a `unclosed")).toBe("a `unclosed");
  });
});

describe("countLines", () => {
  it("counts newline-delimited lines without a phantom trailing line", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
  });
});
