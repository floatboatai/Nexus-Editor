import { describe, expect, it } from "vitest";

import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy";

describe("fuzzyMatch", () => {
  it("reports no match when the subsequence is absent", () => {
    expect(fuzzyMatch("xyz", "foo bar").matched).toBe(false);
    expect(fuzzyMatch("xyz", "foo bar").positions).toEqual([]);
  });

  it("reports no match for empty query or text", () => {
    expect(fuzzyMatch("", "anything").matched).toBe(false);
    expect(fuzzyMatch("anything", "").matched).toBe(false);
  });

  it("returns the correct matched positions for a spread subsequence", () => {
    // "f" at 0, "b" at 4 ("foo bar") — classic fuzzy find.
    const result = fuzzyMatch("fb", "foo bar");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([0, 4]);
  });

  it("matches across word boundaries", () => {
    const result = fuzzyMatch("it", "Insert Table");
    expect(result.matched).toBe(true);
    // Prefers the word-initial "T" (index 7) over the "t" inside "Insert"
    // (index 5) because the separator bonus outweighs the larger gap.
    expect(result.positions).toEqual([0, 7]);
  });

  it("is case-insensitive by default but respects caseSensitive", () => {
    expect(fuzzyMatch("FB", "foo bar").matched).toBe(true);
    expect(fuzzyMatch("FB", "foo bar", { caseSensitive: true }).matched).toBe(false);
    expect(fuzzyMatch("FB", "Foo Bar", { caseSensitive: true }).matched).toBe(true);
  });

  it("ranks a contiguous match above a spread one", () => {
    const tight = fuzzyMatch("abc", "abc").score;
    const spread = fuzzyMatch("abc", "a b c").score;
    expect(tight).toBeGreaterThan(spread);
  });

  it("rewards boundary-aligned matches over interior ones", () => {
    // "ab" at the start beats "ab" buried mid-string.
    const start = fuzzyMatch("ab", "abcd efgh").score;
    const buried = fuzzyMatch("ab", "zz ab zz").score;
    expect(start).toBeGreaterThan(buried);
  });

  it("penalizes long gaps between matched characters", () => {
    const shortGap = fuzzyMatch("az", "a....z").score;
    const longGap = fuzzyMatch("az", "a..............z").score;
    expect(shortGap).toBeGreaterThan(longGap);
  });

  it("picks the optimal alignment, not the greedy leftmost", () => {
    // For "bc" in "abxc", the only valid alignment is b(1)..c(3); positions [1,3].
    const result = fuzzyMatch("bc", "abxc");
    expect(result.positions).toEqual([1, 3]);
  });
});

describe("fuzzyFilter", () => {
  it("returns nothing for a query with no subsequence in any item", () => {
    const items = ["foobar", "fobar", "fbr"];
    expect(fuzzyFilter(items, "zzz", (s) => s)).toEqual([]);
  });

  it("returns every item for an empty query", () => {
    const items = ["alpha", "beta"];
    const scored = fuzzyFilter(items, "", (s) => s);
    expect(scored.map((s) => s.item)).toEqual(["alpha", "beta"]);
  });

  it("sorts by descending score, preferring tighter matches", () => {
    const items = ["foobar", "fobar", "fbr"];
    const scored = fuzzyFilter(items, "fbr", (s) => s);
    expect(scored.map((s) => s.item)).toEqual(["fbr", "fobar", "foobar"]);
  });

  it("preserves matched positions alongside the item", () => {
    const scored = fuzzyFilter(["foo bar"], "fb", (s) => s);
    expect(scored[0].item).toBe("foo bar");
    expect(scored[0].positions).toEqual([0, 4]);
  });
});
