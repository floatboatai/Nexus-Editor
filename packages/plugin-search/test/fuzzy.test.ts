import { describe, expect, it } from "vitest";
import { findFuzzyMatches, fuzzyMatch } from "../src/index";

describe("fuzzyMatch", () => {
  it("returns null for an empty query", () => {
    expect(fuzzyMatch("", "anything")).toBeNull();
  });

  it("matches a contiguous subsequence", () => {
    const result = fuzzyMatch("abc", "abc");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 1, 2]);
  });

  it("matches a scattered (non-contiguous) subsequence", () => {
    const result = fuzzyMatch("abc", "aXbXc");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 2, 4]);
  });

  it("returns null when a character cannot be matched", () => {
    expect(fuzzyMatch("xyz", "abc")).toBeNull();
    expect(fuzzyMatch("abc", "ab")).toBeNull();
  });

  it("is case-insensitive by default but respects caseSensitive", () => {
    expect(fuzzyMatch("ABC", "abc")).not.toBeNull();
    expect(fuzzyMatch("ABC", "abc", true)).toBeNull();
    expect(fuzzyMatch("ABC", "ABC", true)).not.toBeNull();
  });

  it("only extends positions to the last matched character", () => {
    const result = fuzzyMatch("hw", "hello world");
    expect(result!.positions).toEqual([0, 6]);
  });

  it("scores a tight (consecutive) match higher than a scattered one", () => {
    const tight = fuzzyMatch("abc", "abc")!.score;
    const scattered = fuzzyMatch("abc", "a-b-c")!.score;
    expect(tight).toBeGreaterThan(scattered);
  });
});

describe("findFuzzyMatches", () => {
  it("returns no matches for an empty query", () => {
    expect(findFuzzyMatches("hello world", "")).toEqual([]);
  });

  it("finds a single line-spanning fuzzy match", () => {
    expect(findFuzzyMatches("hello world", "hwd")).toEqual([
      { from: 0, to: 11, text: "hello world" }
    ]);
  });

  it("does not cross newline boundaries", () => {
    const doc = "hello world\nfoo bar";
    expect(findFuzzyMatches(doc, "hwd")).toEqual([{ from: 0, to: 11, text: "hello world" }]);
  });

  it("finds fuzzy matches on multiple lines independently", () => {
    const doc = "alpha\nbeta";
    expect(findFuzzyMatches(doc, "ba")).toEqual([{ from: 6, to: 10, text: "beta" }]);
  });

  it("respects case sensitivity across the document", () => {
    const doc = "Apple\napple";
    expect(findFuzzyMatches(doc, "App", { caseSensitive: true })).toEqual([
      { from: 0, to: 3, text: "App" }
    ]);
  });
});
