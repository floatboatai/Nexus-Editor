import { describe, expect, it } from "vitest";
import { findFuzzyMatches, findSearchMatches } from "../src/index";

describe("plugin-search: fuzzy search", () => {
  it("finds non-contiguous subsequence matches", () => {
    const doc = "Nexus-Editor engine powered by CodeMirror 6";
    const matches = findFuzzyMatches(doc, "nxe");

    expect(matches.length).toBeGreaterThan(0);
    const topMatch = matches[0];
    expect(topMatch.text.toLowerCase()).toContain("nexus");
    expect(topMatch.positions).toEqual([0, 2, 6]);
  });

  it("respects caseSensitivity option", () => {
    const doc = "Nexus-Editor engine";
    const caseSensitiveMatches = findFuzzyMatches(doc, "Nxe", { caseSensitive: true });
    expect(caseSensitiveMatches.length).toBe(1);

    const noMatches = findFuzzyMatches(doc, "nxe", { caseSensitive: true });
    expect(noMatches.length).toBe(0);
  });

  it("ranks contiguous prefix matches higher than scattered matches", () => {
    const doc = "nex editor\nnexusextra editor";
    const matches = findFuzzyMatches(doc, "nex");

    expect(matches.length).toBe(2);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
  });

  it("delegates to findFuzzyMatches when options.fuzzy is true", () => {
    const doc = "Floating boat AI Nexus-Editor";
    const matches = findSearchMatches(doc, "fba", { fuzzy: true });

    expect(matches.length).toBe(1);
    expect(matches[0].from).toBe(0);
  });

  it("returns empty array for empty query or doc", () => {
    expect(findFuzzyMatches("", "test")).toEqual([]);
    expect(findFuzzyMatches("sample text", "")).toEqual([]);
  });
});
