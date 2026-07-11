import { describe, expect, it } from "vitest";

import {
  findBestFuzzySpanFromStart,
  findFuzzyMatches,
  pickNextFuzzyMatch,
  pickPreviousFuzzyMatch,
  rankFuzzyMatches,
  scoreFuzzySpan
} from "../src/fuzzy-match";

function findGreedyFuzzySpanFromStart(
  doc: string,
  query: string,
  start: number,
  caseSensitive = false
): { from: number; to: number; score: number; text: string } | null {
  const haystack = caseSensitive ? doc : doc.toLowerCase();
  const needle = (caseSensitive ? query : query.toLowerCase()).trim();
  if (!needle || haystack[start] !== needle[0]) return null;

  let queryIndex = 0;
  let end = start;

  for (let i = start; i < doc.length && queryIndex < needle.length; i++) {
    if (haystack[i] !== needle[queryIndex]) continue;
    end = i + 1;
    queryIndex += 1;
  }

  if (queryIndex < needle.length) return null;

  return {
    from: start,
    to: end,
    text: doc.slice(start, end),
    score: scoreFuzzySpan(doc, start, end, needle, caseSensitive)
  };
}

describe("findBestFuzzySpanFromStart", () => {
  it("scores higher than a greedy minimal-span path when a better subsequence exists", () => {
    const optimal = findBestFuzzySpanFromStart("abbc", "abc", 0);
    const greedy = findGreedyFuzzySpanFromStart("abbc", "abc", 0);

    expect(optimal).not.toBeNull();
    expect(greedy).not.toBeNull();
    expect(optimal!.score).toBeGreaterThan(greedy!.score);
    expect(optimal!.text).toBe("abbc");
  });
});

describe("findFuzzyMatches", () => {
  it("returns minimal-span subsequence matches", () => {
    expect(findFuzzyMatches("hello world", "hwd")).toEqual([
      {
        from: 0,
        to: 11,
        text: "hello world",
        score: expect.any(Number)
      }
    ]);
  });

  it("deduplicates overlapping spans and keeps the highest-quality match", () => {
    const ranked = findFuzzyMatches("alpha beta", "ab");

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.text).toBe("alpha b");
    expect(ranked[0]?.from).toBe(0);
    expect(ranked[0]?.to).toBe(7);
  });

  it("respects case sensitivity", () => {
    expect(findFuzzyMatches("Hello hello", "h", { caseSensitive: true })).toEqual([
      {
        from: 6,
        to: 7,
        text: "h",
        score: expect.any(Number)
      }
    ]);
  });

  it("returns an empty list for whitespace-only queries", () => {
    expect(findFuzzyMatches("hello", "   ")).toEqual([]);
  });

  it("returns an empty list when no subsequence exists", () => {
    expect(findFuzzyMatches("hello", "xyz")).toEqual([]);
  });
});

describe("pickNextFuzzyMatch", () => {
  it("jumps to the highest-scoring match when the selection is not on a match", () => {
    const matches = findFuzzyMatches("abbc xyz", "abc");
    const next = pickNextFuzzyMatch(matches, 8, 8);

    expect(next?.from).toBe(0);
    expect(next?.text).toBe("abbc");
  });

  it("moves to the next document-order match when already on a match", () => {
    const matches = findFuzzyMatches("func call func cast", "fc");
    const first = matches[0];
    expect(first).toBeDefined();

    const next = pickNextFuzzyMatch(matches, first!.from, first!.to);

    expect(next?.from).toBe(10);
  });
});

describe("pickPreviousFuzzyMatch", () => {
  it("jumps to the last match before the cursor when not on a match", () => {
    const matches = findFuzzyMatches("func call func cast", "fc");
    const previous = pickPreviousFuzzyMatch(matches, 20, 20);

    expect(previous?.from).toBe(10);
  });
});

describe("scoreFuzzySpan", () => {
  it("rewards consecutive character hits over scattered gaps", () => {
    const consecutive = scoreFuzzySpan("abc", 0, 3, "abc", false);
    const scattered = scoreFuzzySpan("a-b-c", 0, 5, "abc", false);
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe("rankFuzzyMatches", () => {
  it("keeps non-overlapping matches in document order", () => {
    const ranked = rankFuzzyMatches([
      { from: 10, to: 12, text: "ca", score: 10 },
      { from: 0, to: 4, text: "func", score: 50 }
    ]);

    expect(ranked.map((match) => match.text)).toEqual(["func", "ca"]);
  });
});
