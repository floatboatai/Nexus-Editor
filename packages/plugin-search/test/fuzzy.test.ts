import { describe, expect, it } from "vitest";

import { fuzzyFindAll, fuzzyReplaceAll } from "../src/fuzzy";

describe("fuzzyFindAll", () => {
  it("returns no matches for an empty query", () => {
    expect(fuzzyFindAll("hello world", "")).toEqual([]);
  });

  it("returns no matches when the query is empty after trimming", () => {
    expect(fuzzyFindAll("hello world", "   ")).toEqual([]);
  });

  it("returns no matches for a single-line text with no characters in common", () => {
    expect(fuzzyFindAll("abcdef", "zzz")).toEqual([]);
  });

  it("matches a substring exactly", () => {
    const matches = fuzzyFindAll("hello world", "world");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      from: 6,
      to: 11,
      text: "world",
      positions: [6, 7, 8, 9, 10]
    });
  });

  it("supports character-jump fuzzy matching", () => {
    // h(0) e(1) l(2) l(3) o(4) " "(5) w(6) o(7) r(8) l(9) d(10)
    // "hw" matches positions [0, 6] → slice(0, 7) = "hello w".
    const matches = fuzzyFindAll("hello world", "hw");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(0);
    expect(matches[0]?.to).toBe(7);
    expect(matches[0]?.text).toBe("hello w");
    expect(matches[0]?.positions).toEqual([0, 6]);
  });

  it("prefers consecutive matches over scattered ones", () => {
    // Two candidates: "fo" inside "foo" (consecutive) and across "f_ooooo".
    const matches = fuzzyFindAll("foo bar fooo", "fo");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Highest-scoring match must start at index 0 (consecutive "fo").
    expect(matches[0]?.from).toBe(0);
  });

  it("scores word-start matches higher than mid-word matches", () => {
    // "the" appears in the middle of "another" and at the start of "the".
    const matches = fuzzyFindAll("the quick brown another fox", "the");
    expect(matches[0]?.from).toBe(0);
  });

  it("returns matches in document order across multiple lines", () => {
    const doc = "alpha\nbeta\ngamma";
    const matches = fuzzyFindAll(doc, "al");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(0);
    expect(matches[0]?.to).toBe(2);
  });

  it("finds matches on every matching line", () => {
    // Each line has an 'h' before a 'w' so "hw" matches as a subsequence.
    const doc = "hello world\nhowdy\nhighway";
    const matches = fuzzyFindAll(doc, "hw");
    expect(matches).toHaveLength(3);
    expect(matches[0]?.from).toBe(0);
    expect(matches[1]?.from).toBeGreaterThan(matches[0]?.to ?? 0);
    expect(matches[2]?.from).toBeGreaterThan(matches[1]?.to ?? 0);
  });

  it("preserves document offsets in multi-line input", () => {
    // "line0\n" is 6 chars; "helloworld" starts at 6.
    // h(0) e(1) l(2) l(3) o(4) w(5) o(6) r(7) l(8) d(9)
    // "hw" matches positions [0, 5] → slice(0, 6) = "hello w".
    // After offset: from = 6, to = 6 + 6 = 12.
    const doc = "line0\nhelloworld";
    const matches = fuzzyFindAll(doc, "hw");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(6);
    expect(matches[0]?.to).toBe(12);
  });

  it("is case-insensitive by default", () => {
    const matches = fuzzyFindAll("Hello World", "hw");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(0);
    expect(matches[0]?.to).toBe(7);
  });

  it("respects caseSensitive=true", () => {
    const matchesLower = fuzzyFindAll("Hello World", "hw", { caseSensitive: true });
    expect(matchesLower).toHaveLength(0);

    const matchesUpper = fuzzyFindAll("Hello World", "HW", { caseSensitive: true });
    expect(matchesUpper).toHaveLength(1);
  });

  it("rewards camel-case boundaries in case-insensitive mode", () => {
    // "fb" should match "fooBar" with a camel-case transition at index 3.
    const matches = fuzzyFindAll("fooBar", "fb");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(0);
    expect(matches[0]?.to).toBe(4);
  });

  it("filters matches below the minScoreRatio threshold", () => {
    // Score for a perfect match of "hw" in "hello world" is high; force a
    // high threshold and verify a scattered match is dropped.
    const matches = fuzzyFindAll("a very long line with no chance to match well here", "hw", {
      minScoreRatio: 1
    });
    expect(matches).toHaveLength(0);
  });

  it("keeps perfect matches even with a strict threshold", () => {
    const matches = fuzzyFindAll("hello", "hello", { minScoreRatio: 1 });
    expect(matches).toHaveLength(1);
  });

  it("handles unicode characters (CJK)", () => {
    // Fuzzy works at the character level; CJK counts as a single character.
    const matches = fuzzyFindAll("你好世界", "好世", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe("好世");
  });
});

describe("fuzzyReplaceAll", () => {
  it("replaces every fuzzy match left-to-right", () => {
    // "hello world" → "hello w" matches "hw"; replacement leaves "orld".
    // "how now" → "how" matches "hw"; replacement leaves " now".
    const doc = "hello world\nhow now";
    const out = fuzzyReplaceAll(doc, "hw", "X", {});
    expect(out).toBe("Xorld\nX now");
  });

  it("is a no-op when the query has no matches", () => {
    const doc = "hello world";
    expect(fuzzyReplaceAll(doc, "zzz", "X", {})).toBe(doc);
  });

  it("is a no-op when the query is empty", () => {
    const doc = "hello world";
    expect(fuzzyReplaceAll(doc, "", "X", {})).toBe(doc);
  });

  it("supports a multi-character replacement", () => {
    // "h"(0) "e"(1) "l"(2) "l"(3) "o"(4) " "(5) "w"(6) "o"(7) "r"(8) "l"(9) "d"(10)
    // "hw" matches slice(0, 7) = "hello w".
    const doc = "hello world";
    const out = fuzzyReplaceAll(doc, "hw", "FOO");
    expect(out).toBe("FOOorld");
  });
});
