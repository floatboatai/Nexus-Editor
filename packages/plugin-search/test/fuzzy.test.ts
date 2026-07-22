import { describe, expect, it } from "vitest";

import { fuzzyMatch, findFuzzyMatches } from "../src/fuzzy";

describe("fuzzyMatch — basic matching", () => {
  it("matches an exact string", () => {
    const result = fuzzyMatch("hello", "hello");
    expect(result).not.toBeNull();
    expect(result!.from).toBe(0);
    expect(result!.to).toBe(5);
    expect(result!.text).toBe("hello");
    expect(result!.positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches a subsequence", () => {
    const result = fuzzyMatch("fuzzy search", "fzs");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 2, 6]);
    expect(result!.text).toBe("fuzzy s");
  });

  it("returns null when the query is empty", () => {
    expect(fuzzyMatch("hello", "")).toBeNull();
  });

  it("returns null when the query is longer than the text", () => {
    expect(fuzzyMatch("hi", "hello")).toBeNull();
  });

  it("returns null when characters are missing", () => {
    expect(fuzzyMatch("abc", "axc")).toBeNull();
  });

  it("returns null when characters are out of order", () => {
    expect(fuzzyMatch("abc", "cba")).toBeNull();
  });
});

describe("fuzzyMatch — case sensitivity", () => {
  it("matches case-insensitively by default", () => {
    const result = fuzzyMatch("Hello World", "hlo");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 2, 4]);
  });

  it("respects caseSensitive option", () => {
    expect(fuzzyMatch("Hello World", "Hlo", { caseSensitive: true })).not.toBeNull();
    expect(fuzzyMatch("Hello World", "hlo", { caseSensitive: true })).toBeNull();
  });
});

describe("fuzzyMatch — scoring", () => {
  it("scores an exact match higher than a scattered one", () => {
    const exact = fuzzyMatch("hello", "hello")!;
    const scattered = fuzzyMatch("h e l l o", "hello")!;
    expect(exact.score).toBeGreaterThan(scattered.score);
  });

  it("rewards consecutive character runs", () => {
    const consecutive = fuzzyMatch("abcdef", "abc")!;
    const spread = fuzzyMatch("axbxcx", "abc")!;
    expect(consecutive.score).toBeGreaterThan(spread.score);
  });

  it("rewards word-boundary starts", () => {
    const atBoundary = fuzzyMatch("hello world", "wo")!;
    const midWord = fuzzyMatch("hello world", "or")!;
    expect(atBoundary.score).toBeGreaterThan(midWord.score);
  });

  it("never returns a negative score", () => {
    const result = fuzzyMatch("a b c d e f", "af")!;
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("fuzzyMatch — maxGap", () => {
  it("matches within the default gap limit", () => {
    const text = "a" + " ".repeat(60) + "b";
    expect(fuzzyMatch(text, "ab")).not.toBeNull();
  });

  it("rejects matches that exceed maxGap", () => {
    const text = "a" + " ".repeat(100) + "b";
    expect(fuzzyMatch(text, "ab", { maxGap: 64 })).toBeNull();
  });

  it("respects a custom maxGap", () => {
    const text = "a" + " ".repeat(10) + "b";
    expect(fuzzyMatch(text, "ab", { maxGap: 5 })).toBeNull();
    expect(fuzzyMatch(text, "ab", { maxGap: 20 })).not.toBeNull();
  });
});

describe("fuzzyMatch — best match selection", () => {
  it("prefers the highest-scoring match across starting positions", () => {
    const text = "xabcx abc";
    const result = fuzzyMatch(text, "abc")!;
    // The second "abc" is an exact consecutive match → higher score
    expect(result.from).toBe(6);
  });

  it("prefers a match at a word boundary over a mid-word match", () => {
    const text = "xhello hello";
    const result = fuzzyMatch(text, "hello")!;
    expect(result.from).toBe(7);
  });
});

describe("findFuzzyMatches — basic scanning", () => {
  it("finds a single match", () => {
    const matches = findFuzzyMatches("hello world", "hlo");
    expect(matches).toHaveLength(1);
    expect(matches[0].positions).toEqual([0, 2, 4]);
  });

  it("finds multiple non-overlapping matches", () => {
    const matches = findFuzzyMatches("foo bar foo baz", "fo");
    expect(matches).toHaveLength(2);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(8);
  });

  it("returns empty array for empty query", () => {
    expect(findFuzzyMatches("hello", "")).toEqual([]);
  });

  it("returns empty array when no match exists", () => {
    expect(findFuzzyMatches("hello", "xyz")).toEqual([]);
  });

  it("returns empty array when query is longer than document", () => {
    expect(findFuzzyMatches("hi", "hello")).toEqual([]);
  });
});

describe("findFuzzyMatches — non-overlapping guarantee", () => {
  it("does not produce overlapping matches", () => {
    const matches = findFuzzyMatches("aaa", "aa");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(2);
  });

  it("advances past each match window", () => {
    const matches = findFuzzyMatches("ababab", "ab");
    expect(matches).toHaveLength(3);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(2);
    expect(matches[2].from).toBe(4);
  });
});

describe("findFuzzyMatches — case sensitivity", () => {
  it("matches case-insensitively by default", () => {
    const matches = findFuzzyMatches("Hello HELLO", "hlo");
    expect(matches).toHaveLength(2);
  });

  it("respects caseSensitive option", () => {
    expect(findFuzzyMatches("Hello HELLO", "Hlo", { caseSensitive: true })).toHaveLength(1);
  });
});

describe("findFuzzyMatches — maxGap", () => {
  it("skips matches that exceed maxGap", () => {
    const doc = "a" + " ".repeat(100) + "b" + "ab";
    const matches = findFuzzyMatches(doc, "ab", { maxGap: 64 });
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(102);
  });

  it("finds matches with a generous maxGap", () => {
    const doc = "a b c d e";
    const matches = findFuzzyMatches(doc, "abc", { maxGap: 10 });
    expect(matches).toHaveLength(1);
  });
});

describe("findFuzzyMatches — edge cases", () => {
  it("handles a single-character query", () => {
    const matches = findFuzzyMatches("abcabc", "a");
    expect(matches).toHaveLength(2);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(3);
  });

  it("handles a query that matches at the very end", () => {
    const matches = findFuzzyMatches("hello", "lo");
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(2);
    expect(matches[0].to).toBe(5);
  });

  it("handles a document consisting of repeated characters", () => {
    const matches = findFuzzyMatches("aaaa", "aa");
    expect(matches).toHaveLength(2);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(2);
  });

  it("includes score and positions in every result", () => {
    const matches = findFuzzyMatches("hello", "hlo");
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].positions).toEqual([0, 2, 4]);
    expect(matches[0].text).toBe("hello");
  });
});
