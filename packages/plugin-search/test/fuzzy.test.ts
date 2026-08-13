import { describe, expect, it } from "vitest";
import { createFuzzySearchCursor, fuzzyMatch, indicesToRanges } from "../src/fuzzy";

describe("fuzzyMatch", () => {
  it("returns null for empty pattern or text", () => {
    expect(fuzzyMatch("", "hello")).toBeNull();
    expect(fuzzyMatch("hello", "")).toBeNull();
  });

  it("returns null when pattern is longer than text", () => {
    expect(fuzzyMatch("hello world", "hello")).toBeNull();
  });

  it("returns exact match with high score", () => {
    const result = fuzzyMatch("nexus", "nexus editor");
    expect(result).not.toBeNull();
    expect(result?.ranges).toEqual([{ from: 0, to: 5 }]);
    expect(result?.score).toBeGreaterThan(50);
  });

  it("matches non-contiguous subsequence characters", () => {
    const result = fuzzyMatch("fltbt", "floatboat editor");
    expect(result).not.toBeNull();
    expect(result?.ranges.length).toBeGreaterThan(1);
    expect(result?.text).toBe("floatboat editor");
  });

  it("respects case sensitivity option", () => {
    expect(fuzzyMatch("NEXUS", "nexus editor", { caseSensitive: true })).toBeNull();
    expect(fuzzyMatch("NEXUS", "nexus editor", { caseSensitive: false })).not.toBeNull();
    expect(fuzzyMatch("NEXUS", "NEXUS editor", { caseSensitive: true })).not.toBeNull();
  });

  it("gives word boundary bonus for matching at start of words", () => {
    const startMatch = fuzzyMatch("ne", "nexus editor");
    const midMatch = fuzzyMatch("ex", "nexus editor");
    expect(startMatch).not.toBeNull();
    expect(midMatch).not.toBeNull();
    expect(startMatch!.score).toBeGreaterThan(midMatch!.score);
  });
});

describe("indicesToRanges", () => {
  it("converts sequential indices to range blocks", () => {
    expect(indicesToRanges([0, 1, 2, 5, 6, 9])).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 7 },
      { from: 9, to: 10 }
    ]);
  });
});

describe("createFuzzySearchCursor", () => {
  it("iterates line-by-line fuzzy matches", () => {
    const doc = "First line with floatboat\nSecond line with nexus\nThird line with floatboat editor";
    const cursor = createFuzzySearchCursor(doc, "fltbt");

    const m1 = cursor.next();
    expect(m1.done).toBe(false);
    expect(m1.value?.from).toBeGreaterThanOrEqual(0);

    const m2 = cursor.next();
    expect(m2.done).toBe(false);
    expect(m2.value?.from).toBeGreaterThan(25);

    const m3 = cursor.next();
    expect(m3.done).toBe(true);
  });
});
