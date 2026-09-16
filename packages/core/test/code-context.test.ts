import { describe, expect, it } from "vitest";

import { findCodeContextSpans, overlapsSpan } from "../src/code-context";
import { lezerStringToMdast } from "../src/lezer-mdast-adapter";

/** Code spans as the mdast sees them, restricted to the two node types the
 *  text-level scanner claims to cover. */
function astCodeSpans(doc: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const candidate = node as {
      type?: string;
      position?: { start: { offset?: number }; end: { offset?: number } };
      children?: unknown;
    };
    const start = candidate.position?.start.offset;
    const end = candidate.position?.end.offset;
    if (
      (candidate.type === "code" || candidate.type === "inlineCode") &&
      typeof start === "number" &&
      typeof end === "number"
    ) {
      spans.push([start, end]);
    }
    if (candidate.children) walk(candidate.children);
  };
  walk(lezerStringToMdast(doc));
  return spans.sort((left, right) => left[0] - right[0]);
}

describe("findCodeContextSpans", () => {
  it("returns nothing for prose without code", () => {
    expect(findCodeContextSpans("Just [[a]] sentence.")).toEqual([]);
  });

  it("covers a fenced block including its fences", () => {
    const doc = ["```md", "body", "```"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("covers an inline code span including its backticks", () => {
    const doc = "Use `code` here.";
    expect(findCodeContextSpans(doc)).toEqual([[4, 10]]);
  });

  it("treats a fence with a longer closing run as one block", () => {
    const doc = ["````", "body", "`````"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("does not close a backtick fence with a shorter run", () => {
    const doc = ["````", "body", "```", "still code", "````"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("does not let a backtick fence carry a backtick in its info string", () => {
    // Per CommonMark `...` is prose, so the line is one code span rather than a
    // fenced block. Also covered by the parser corpus below.
    const doc = "``` `x` ```";
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("runs an unterminated fence to end of document", () => {
    const doc = ["```", "body"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("does not treat four-space indentation as a fence", () => {
    expect(findCodeContextSpans("    ```\n    x")).toEqual([]);
  });

  it("pairs a code span across a line break", () => {
    const doc = "a `one\ntwo` b";
    expect(findCodeContextSpans(doc)).toEqual([[2, 11]]);
  });

  it("does not pair a code span across a blank line", () => {
    expect(findCodeContextSpans("a `one\n\ntwo` b")).toEqual([]);
  });

  it("requires a closing run of exactly equal length", () => {
    // The `` run is closed by the next `` run; the single ` inside stays literal.
    const doc = "``a`b``";
    expect(findCodeContextSpans(doc)).toEqual([[0, 7]]);
  });

  it("leaves an unmatched backtick run literal", () => {
    expect(findCodeContextSpans("a ` b")).toEqual([]);
  });

  it("does not search for code spans inside a fenced block", () => {
    const doc = ["```", "`now closed`", "```"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([[0, doc.length]]);
  });

  it("finds a code span after a closed fence", () => {
    const doc = ["```", "x", "```", "", "a `b` c"].join("\n");
    const spans = findCodeContextSpans(doc);
    expect(spans).toEqual([
      [0, 9],
      [13, 16]
    ]);
  });

  it("reports overlap for a match touching a span", () => {
    const spans = findCodeContextSpans("a `code` b");
    expect(overlapsSpan(2, 8, spans)).toBe(true);
    expect(overlapsSpan(0, 1, spans)).toBe(false);
  });

  it("reports overlap when a match only partially enters a span", () => {
    const spans = findCodeContextSpans("a `code` b");
    expect(overlapsSpan(7, 12, spans)).toBe(true);
  });
});

/**
 * The scanner is a text-level stand-in for a parse that is not available to
 * the wiki-link callers that index vault files and plugin content. This keeps
 * it from drifting away from the real parser: every document below must yield
 * exactly the `code` / `inlineCode` spans the mdast reports.
 *
 * Cases outside the contract — indented code blocks and raw HTML blocks — are
 * asserted separately so the boundary stays visible instead of silent.
 */
describe("findCodeContextSpans — agrees with the mdast", () => {
  const corpus: string[] = [
    "plain text only",
    "a `code span` and [[a link]]",
    "``double `tick`` span",
    "```js\nconst a = 1;\n```",
    "~~~\nplain\n~~~",
    "````\nfence\n````",
    ["before", "", "```md", "see [[InsideFence]]", "```", "", "after"].join("\n"),
    ["# Title", "", "- item `code`", "", "> quote `x`"].join("\n"),
    "para with `a` and `b` spans",
    ["```", "```"].join("\n"),
    ["   ```", "indented fence", "   ```"].join("\n"),
    ["one", "```", "two", "````", "three", "````"].join("\n"),
    "`start` middle `end`",
    ["| a | b |", "|---|---|", "| `x` | [[y]] |"].join("\n"),
    "text with a `span` and\na soft break `another`",
    ["- `a`", "- `b`"].join("\n"),
    "```\n[[not a link]]\n```\nthen `code`",
    ["``", "``"].join("\n"),
    "[[plain link]] with `[[quoted]]` inside code",
    ["foo", "", "```", "bar", "```", "", "`baz`"].join("\n"),
    "``` `x` ```",
    ["```", "x", "```", "", "a `b` c"].join("\n"),
    ["````", "body", "```", "still code", "````"].join("\n"),
    "a `one\ntwo` b",
    "`a` and `b`",
    "an `unclosed run",
    ["```", "", "```"].join("\n"),
    ["text", "    ", "```", "fence after blank", "```"].join("\n")
  ];

  for (const [index, doc] of corpus.entries()) {
    it(`matches the parser on corpus case ${index}`, () => {
      expect(findCodeContextSpans(doc)).toEqual(astCodeSpans(doc));
    });
  }
});

describe("findCodeContextSpans — documented boundaries", () => {
  it("does not cover indented code blocks (paragraph-interrupt rules)", () => {
    // A four-space indented block IS a `code` node in the mdast, but detecting
    // it textually requires paragraph-continuation state, and a wrong guess
    // would silently drop real links from nested list content. Documented
    // rather than approximated.
    const doc = ["para", "", "    indented code", "", "after"].join("\n");
    expect(astCodeSpans(doc)).toHaveLength(1);
    expect(findCodeContextSpans(doc)).toEqual([]);
  });

  it("does not cover raw HTML blocks", () => {
    // The design note this fix follows scopes the gap to code spans.
    const doc = ["<div>", "[[x]]", "</div>"].join("\n");
    expect(findCodeContextSpans(doc)).toEqual([]);
  });
});
