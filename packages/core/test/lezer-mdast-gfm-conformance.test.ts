import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";

/**
 * Differential conformance: for every GFM construct below, the Lezer→mdast
 * adapter must emit the same *structure* as `remark-gfm` (the reference mdast
 * for GitHub Flavored Markdown). `position` is dropped because the adapter
 * only fills `offset` (line/column are placeholders) and live-preview reads
 * the syntax tree directly, so offsets are out of scope for this harness.
 */
function normalize(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(normalize);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "position") continue;
    if (value === undefined) continue;
    out[key] = normalize(value);
  }
  return out;
}

const processor = unified().use(remarkParse).use(remarkGfm);

// Only constructs the adapter is expected to round-trip. Deliberately excludes
// shapes with known, separately-tracked fidelity gaps (closed-ATX / setext
// headings, fenced-code info strings, link/image titles, reference links) so
// the harness stays green against the subset this PR owns.
const GFM_CASES: string[] = [
  "plain text",
  "# heading",
  "## heading",
  "**bold**",
  "*em*",
  "~~del~~",
  "**bold** and *em* and ~~del~~",
  "`code`",
  "- a\n- b",
  "- a\n- b\n- c",
  "1. a\n2. b",
  "- [x] done",
  "- [ ] todo",
  "- [x] done\n- [ ] todo",
  "- [x] **done** with `code`",
  "> quote",
  "---",
  "<https://example.com>",
  "see https://example.com now",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
  "| a | b |\n| :--- | ---: |\n| 1 | 2 |",
  "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |",
];

describe("lezer → mdast GFM conformance (vs remark-gfm)", () => {
  it.each(GFM_CASES)("round-trips %j", (markdown) => {
    const actual = normalize(lezerStringToMdast(markdown));
    const expected = normalize(processor.parse(markdown));
    expect(actual).toEqual(expected);
  });
});
