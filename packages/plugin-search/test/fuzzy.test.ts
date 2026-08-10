import { describe, expect, it } from "vitest";
import { findFuzzyMatches } from "../src/fuzzy";

describe("findFuzzyMatches", () => {
  it("matches characters that are separated in the document", () => {
    expect(findFuzzyMatches("CreateSearchPlugin", "csp")).toEqual([
      expect.objectContaining({ from: 0, to: 18 })
    ]);
  });

  it("is case-insensitive", () => {
    expect(findFuzzyMatches("Nexus Editor", "NE")).toHaveLength(1);
  });

  it("prefers a contiguous match over a larger gap", () => {
    const matches = findFuzzyMatches("foo fizzle", "fo");
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].to - matches[0].from).toBe(2);
  });

  it("prefers word boundaries when matching the same query", () => {
    const matches = findFuzzyMatches("catalog cat", "cat");
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(8);
    expect(matches[1].score).toBeGreaterThan(matches[0].score);
  });

  it("returns document-order, non-overlapping matches", () => {
    expect(findFuzzyMatches("abc abc", "abc")).toEqual([
      { from: 0, to: 3, score: expect.any(Number) },
      { from: 4, to: 7, score: expect.any(Number) }
    ]);
  });

  it("returns no matches when the query cannot be formed as a subsequence", () => {
    expect(findFuzzyMatches("editor", "xyz")).toEqual([]);
  });

  it("handles empty input without allocating match state", () => {
    expect(findFuzzyMatches("", "abc")).toEqual([]);
    expect(findFuzzyMatches("abc", "")).toEqual([]);
  });

  it("supports Unicode letters in word-boundary scoring", () => {
    const matches = findFuzzyMatches("你好 世界", "世");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(3);
  });
});
