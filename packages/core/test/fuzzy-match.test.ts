import { describe, expect, it } from "vitest";

import { matchFuzzy } from "../src/fuzzy-match";

function positions(query: string, target: string): number[] {
  const match = matchFuzzy(query, target);
  if (!match) throw new Error(`Expected "${query}" to match "${target}"`);
  return match.positions;
}

function score(query: string, target: string): number {
  const match = matchFuzzy(query, target);
  if (!match) throw new Error(`Expected "${query}" to match "${target}"`);
  return match.score;
}

describe("matchFuzzy rejection", () => {
  it("returns null for an empty query", () => {
    expect(matchFuzzy("", "Table")).toBeNull();
  });

  it("returns null for an empty target", () => {
    expect(matchFuzzy("t", "")).toBeNull();
  });

  it("returns null when the query is not a subsequence", () => {
    expect(matchFuzzy("zzz", "Table")).toBeNull();
    expect(matchFuzzy("lt", "Table")).toBeNull();
    expect(matchFuzzy("tablet", "Table")).toBeNull();
  });
});

describe("matchFuzzy alignment", () => {
  it("matches a non-contiguous subsequence", () => {
    expect(positions("tbl", "Table")).toEqual([0, 2, 3]);
    expect(positions("h2", "Heading 2")).toEqual([0, 8]);
  });

  it("prefers the contiguous alignment over a scattered one", () => {
    // "a1b" aligns on the first three characters, but " ab" is contiguous.
    expect(positions("ab", "a1b ab")).toEqual([4, 5]);
  });

  it("scores a word start above a mid-word start", () => {
    expect(score("hb", "Home Bar")).toBeGreaterThan(score("hb", "Shabby"));
  });

  it("recognises camelCase humps", () => {
    expect(positions("gc", "getContent")).toEqual([0, 3]);
  });

  it("treats separators as word starts", () => {
    expect(positions("ir", "insert-row")).toEqual([0, 7]);
    expect(score("ir", "insert-row")).toBeGreaterThan(score("ir", "insertprow"));
  });

  it("rewards an exact-case hit while matching case-insensitively", () => {
    expect(score("Hd", "Heading")).toBeGreaterThan(score("hd", "Heading"));
  });

  it("returns one ascending position per query character", () => {
    const cases: Array<[string, string]> = [
      ["tbl", "Table"],
      ["toc", "Table of Contents"],
      ["hr", "Horizontal rule"],
      ["表格", "插入表格"],
      ["bo", "Bold"]
    ];

    for (const [query, target] of cases) {
      const result = positions(query, target);
      expect(result).toHaveLength(Array.from(query).length);
      expect([...result].sort((a, b) => a - b)).toEqual(result);
      for (const position of result) {
        expect(position).toBeGreaterThanOrEqual(0);
        expect(position).toBeLessThan(target.length);
      }
    }
  });

  it("is deterministic across repeated calls", () => {
    const first = matchFuzzy("toc", "Table of Contents");
    const second = matchFuzzy("toc", "Table of Contents");
    expect(second).toEqual(first);
  });
});

describe("matchFuzzy case sensitivity", () => {
  it("matches case-insensitively by default", () => {
    expect(positions("tbl", "Table")).toEqual([0, 2, 3]);
  });

  it("honours caseSensitive", () => {
    expect(matchFuzzy("tbl", "Table", { caseSensitive: true })).toBeNull();
    expect(matchFuzzy("Tbl", "Table", { caseSensitive: true })?.positions).toEqual([0, 2, 3]);
  });
});

describe("matchFuzzy unicode", () => {
  it("matches CJK queries", () => {
    expect(positions("表格", "插入表格")).toEqual([2, 3]);
  });

  it("keeps astral characters whole", () => {
    const target = "say 👋 now";
    const result = matchFuzzy("👋", target);

    expect(result?.positions).toEqual([4]);
    expect(target.slice(result?.positions[0] ?? 0, (result?.positions[0] ?? 0) + 2)).toBe("👋");
  });

  it("does not split an astral character when highlighting around it", () => {
    const target = "👋 wave";
    const result = matchFuzzy("👋w", target);

    // The emoji occupies two UTF-16 code units, then " wave" → "w" is at offset 3.
    expect(result?.positions).toEqual([0, 3]);
  });
});

describe("matchFuzzy long targets", () => {
  it("still aligns when the target exceeds the optimal-alignment limit", () => {
    const target = `${"x".repeat(600)}tbl`;
    const result = matchFuzzy("tbl", target);

    expect(result?.positions).toEqual([600, 601, 602]);
    expect(result?.positions).toHaveLength(3);
  });

  it("returns null for a non-matching long target", () => {
    expect(matchFuzzy("tbl", "x".repeat(600))).toBeNull();
  });

  it("scores the long-target path with the same weights as the optimal path", () => {
    // Both alignments start at index 0, so the two paths must agree.
    expect(score("ab", `ab ab${"x".repeat(600)}`)).toBe(score("ab", "ab ab"));
  });
});
