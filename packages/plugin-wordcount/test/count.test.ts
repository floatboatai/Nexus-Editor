import { describe, expect, it } from "vitest";

import { countMarkdown, countMarkdownAsync, type WordCountStats } from "../src/count";

const zeroStats = (): WordCountStats => ({
  words: 0,
  latinWords: 0,
  cjkCharacters: 0,
  characters: 0,
  charactersNoSpaces: 0,
  lines: 0,
  paragraphs: 0,
  sentences: 0,
  readingTimeSeconds: 0
});

describe("countMarkdown — basic prose", () => {
  it("returns zeros for an empty document", () => {
    expect(countMarkdown("")).toEqual(zeroStats());
  });

  it("counts plain English prose", () => {
    const result = countMarkdown("Hello, World!");
    expect(result.words).toBe(2);
    expect(result.latinWords).toBe(2);
    expect(result.cjkCharacters).toBe(0);
    expect(result.characters).toBe(13);
    expect(result.charactersNoSpaces).toBe(12);
    expect(result.sentences).toBe(1);
    expect(result.paragraphs).toBe(1);
    expect(result.readingTimeSeconds).toBeGreaterThanOrEqual(1);
  });

  it("counts numbers as a single word", () => {
    const result = countMarkdown("There are 42 lights.");
    expect(result.words).toBe(4);
  });

  it("treats apostrophes / curly quotes as part of the same word", () => {
    const result = countMarkdown("Don\u2019t can't won't");
    expect(result.words).toBe(3);
  });

  it("never throws on garbage input", () => {
    expect(() => countMarkdown("\u0000\u0001\uFFFE   ```unterminated")).not.toThrow();
  });
});

describe("countMarkdown — markdown awareness", () => {
  it("excludes fenced code blocks by default", () => {
    const source = "text\n\n```js\nconst x = 1;\n```\n";
    const result = countMarkdown(source);
    expect(result.words).toBe(1);
  });

  it("excludes inline code by default", () => {
    const result = countMarkdown("`abc def` ghi");
    expect(result.words).toBe(1);
  });

  it("excludes YAML frontmatter", () => {
    const source = "---\ntitle: foo\nauthor: bar\n---\nhello";
    const result = countMarkdown(source);
    expect(result.words).toBe(1);
  });

  it("excludes HTML blocks and comments", () => {
    // CommonMark: an HTML block starting with `<!--` consumes the
    // remainder of the block until the closing `-->`. A blank line
    // ends the HTML block so trailing prose is parsed normally.
    const result = countMarkdown("<!-- private -->\n\nhello world");
    expect(result.words).toBe(2);
  });

  it("excludes inline HTML mixed with prose", () => {
    const result = countMarkdown("foo <span>inline</span> bar");
    // remark-parse treats `<span>` / `</span>` as inline HTML — excluded;
    // surrounding prose ("foo", "inline", "bar") still counts.
    expect(result.words).toBeGreaterThanOrEqual(2);
  });

  it("excludes inline math", () => {
    const result = countMarkdown("$x^2 + y^2$ done");
    expect(result.words).toBe(1);
  });

  it("excludes display math", () => {
    const result = countMarkdown("$$\nx = 1\n$$\n\nDone");
    expect(result.words).toBe(1);
  });

  it("excludes link / footnote definitions", () => {
    const source = "See [the link][a].\n\n[a]: https://example.com \"Title\"";
    const result = countMarkdown(source);
    // "See", "the", "link" = 3 words; the definition's URL / title are excluded.
    expect(result.words).toBe(3);
  });

  it("includes image alt text by default", () => {
    const result = countMarkdown("![a sleepy cat](cat.png)");
    expect(result.words).toBe(3);
  });

  it("respects explicit `exclude: ['image']` override", () => {
    const result = countMarkdown("![a sleepy cat](cat.png)", { exclude: ["image"] });
    expect(result.words).toBe(0);
  });

  it("counts heading text", () => {
    const result = countMarkdown("# Big Title\n\nSome body.");
    // 2 + 2 = 4 words; heading text counted.
    expect(result.words).toBe(4);
  });

  it("walks blockquotes and lists", () => {
    const source = "> quoted text\n\n- alpha beta\n- gamma";
    const result = countMarkdown(source);
    // "quoted text" + "alpha beta" + "gamma" = 5 words
    expect(result.words).toBe(5);
  });

  it("recovers gracefully when content forms only excluded nodes", () => {
    const result = countMarkdown("```js\nlet x = 1;\n```\n");
    expect(result.words).toBe(0);
    expect(result.lines).toBeGreaterThan(0);
  });
});

describe("countMarkdown — CJK handling", () => {
  it("counts each CJK character as one word by default", () => {
    const result = countMarkdown("你好，世界。");
    expect(result.words).toBe(4);
    expect(result.cjkCharacters).toBe(4);
    expect(result.sentences).toBe(1);
  });

  it("supports `cjkUnit: 'word'` to collapse runs", () => {
    const result = countMarkdown("你好世界", { cjkUnit: "word" });
    expect(result.words).toBe(1);
    expect(result.cjkCharacters).toBe(4);
  });

  it("counts mixed Latin and CJK distinctly", () => {
    const result = countMarkdown("Hello 世界 today");
    expect(result.latinWords).toBe(2);
    expect(result.cjkCharacters).toBe(2);
    expect(result.words).toBe(4);
  });

  it("handles Hiragana / Katakana / Hangul", () => {
    const result = countMarkdown("こんにちは カタカナ 안녕");
    expect(result.cjkCharacters).toBe(5 + 4 + 2);
    expect(result.words).toBe(5 + 4 + 2);
  });

  it("counts a CJK sentence terminator correctly", () => {
    const result = countMarkdown("第一句。第二句！第三句？");
    expect(result.sentences).toBe(3);
  });
});

describe("countMarkdown — derived fields", () => {
  it("counts lines using CodeMirror semantics", () => {
    expect(countMarkdown("a\nb\nc").lines).toBe(3);
    expect(countMarkdown("a\nb\nc\n").lines).toBe(3);
    expect(countMarkdown("a").lines).toBe(1);
    expect(countMarkdown("").lines).toBe(0);
  });

  it("counts paragraphs as mdast paragraph nodes", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n\nThird.";
    expect(countMarkdown(source).paragraphs).toBe(3);
  });

  it("reading time floors at 1 second when there is any prose", () => {
    expect(countMarkdown("hi").readingTimeSeconds).toBeGreaterThanOrEqual(1);
  });

  it("reading time respects custom wpm", () => {
    const source = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const stats = countMarkdown(source, { readingSpeed: { wpm: 100 } });
    expect(stats.latinWords).toBe(100);
    expect(stats.readingTimeSeconds).toBe(60);
  });

  it("reading time combines Latin and CJK rates", () => {
    const latin = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const cjk = "字".repeat(500);
    const source = `${latin}\n\n${cjk}`;
    const stats = countMarkdown(source);
    const expected = Math.ceil((100 / 238) * 60 + (500 / 500) * 60);
    expect(stats.readingTimeSeconds).toBe(expected);
  });

  it("returns zero reading time for an empty document", () => {
    expect(countMarkdown("").readingTimeSeconds).toBe(0);
  });
});

describe("countMarkdown — heuristic sentences", () => {
  it("splits on standard terminators", () => {
    expect(countMarkdown("First. Second! Third?").sentences).toBe(3);
  });

  it("returns 1 for a heading without terminator", () => {
    expect(countMarkdown("# Introduction").sentences).toBe(1);
  });

  it("returns 0 for an empty prose body", () => {
    expect(countMarkdown("```js\n1\n```").sentences).toBe(0);
  });
});

describe("countMarkdownAsync", () => {
  it("returns the same result as the sync entry point", async () => {
    const source = "Hello world.\n\n你好世界。";
    const sync = countMarkdown(source);
    const async_ = await countMarkdownAsync(source);
    expect(async_).toEqual(sync);
  });

  it("forwards options", async () => {
    const stats = await countMarkdownAsync("你好", { cjkUnit: "word" });
    expect(stats.words).toBe(1);
  });
});
