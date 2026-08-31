import { describe, expect, it } from "vitest";
import { findFuzzyMatches } from "../src/fuzzy";

describe("findFuzzyMatches", () => {
  it("finds a contiguous exact match", () => {
    const matches = findFuzzyMatches("hello world", "hello");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(5);
    expect(matches[0].text).toBe("hello");
    expect(matches[0].positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("finds a scattered subsequence match", () => {
    const matches = findFuzzyMatches("h e l l o", "hello");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(9);
    expect(matches[0].text).toBe("h e l l o");
    expect(matches[0].positions).toEqual([0, 2, 4, 6, 8]);
  });

  it("is case-insensitive by default", () => {
    const matches = findFuzzyMatches("Hello World", "hW");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Hello W");
  });

  it("respects caseSensitive option", () => {
    expect(findFuzzyMatches("Hello World", "hw", { caseSensitive: true })).toHaveLength(0);
    const matches = findFuzzyMatches("Hello World", "HW", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Hello W");
  });

  it("ranks contiguous matches above scattered ones", () => {
    const matches = findFuzzyMatches("abc x a b c", "abc");
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // The contiguous "abc" at position 0 should outrank the scattered "a b c"
    expect(matches[0].from).toBe(0);
    expect(matches[0].text).toBe("abc");
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it("ranks matches at word boundaries higher", () => {
    const matches = findFuzzyMatches("xabc abc", "abc");
    expect(matches).toHaveLength(2);
    // "abc" at position 5 starts after a space (word boundary), should outrank "xabc"
    expect(matches[0].from).toBe(5);
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it("returns empty array for empty query", () => {
    expect(findFuzzyMatches("hello", "")).toEqual([]);
    expect(findFuzzyMatches("hello", "   ")).toEqual([]);
  });

  it("returns empty array when no match exists", () => {
    expect(findFuzzyMatches("hello world", "xyz")).toEqual([]);
  });

  it("returns empty array when query is longer than document", () => {
    expect(findFuzzyMatches("ab", "abcdef")).toEqual([]);
  });

  it("respects the limit option", () => {
    const doc = "a".repeat(100);
    const all = findFuzzyMatches(doc, "a", { limit: 0 });
    expect(all.length).toBe(100);

    const limited = findFuzzyMatches(doc, "a", { limit: 10 });
    expect(limited.length).toBe(10);
  });

  it("uses default limit of 50", () => {
    const doc = "a".repeat(100);
    const matches = findFuzzyMatches(doc, "a");
    expect(matches.length).toBe(50);
  });

  it("finds multiple non-overlapping matches", () => {
    const matches = findFuzzyMatches("foo bar foo baz", "foo");
    expect(matches).toHaveLength(2);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(8);
  });

  it("preserves original case in returned text", () => {
    const matches = findFuzzyMatches("HeLLo WoRLd", "hello");
    expect(matches[0].text).toBe("HeLLo");
  });

  it("matches single character query", () => {
    const matches = findFuzzyMatches("banana", "a");
    expect(matches.length).toBe(3);
    expect(matches.map((m) => m.from)).toEqual([1, 3, 5]);
  });

  it("sorts ties by document position", () => {
    const matches = findFuzzyMatches("xab yab", "ab");
    expect(matches).toHaveLength(2);
    expect(matches[0].score).toBe(matches[1].score);
    expect(matches[0].from).toBe(1);
    expect(matches[1].from).toBe(5);
  });

  it("matches query with repeated characters", () => {
    const matches = findFuzzyMatches("hello", "ll");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(2);
    expect(matches[0].to).toBe(4);
    expect(matches[0].positions).toEqual([2, 3]);
  });

  it("trims whitespace from query", () => {
    const matches = findFuzzyMatches("hello world", "  hello  ");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("hello");
  });

  it("scores consecutive runs with increasing bonus", () => {
    const contiguous = findFuzzyMatches("abcdef", "abc")[0];
    const scattered = findFuzzyMatches("a b c d e f", "abc")[0];
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it("handles document with only whitespace", () => {
    expect(findFuzzyMatches("   ", "a")).toEqual([]);
  });

  it("handles unicode characters", () => {
    const matches = findFuzzyMatches("你好世界", "你世");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(3);
    expect(matches[0].text).toBe("你好世");
  });
});
