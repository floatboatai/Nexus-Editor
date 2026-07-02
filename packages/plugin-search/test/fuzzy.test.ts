import { describe, expect, it } from "vitest";
import { findFuzzyMatches, fuzzyMatch } from "../src/index";

function scoreOf(text: string, query: string, caseSensitive = false): number {
  const result = fuzzyMatch(text, query, { caseSensitive });
  expect(result).not.toBeNull();
  return result!.score;
}

describe("fuzzyMatch", () => {
  it("matches a contiguous substring and reports its positions", () => {
    expect(fuzzyMatch("hello world", "wor")).toEqual({
      score: expect.any(Number),
      positions: [6, 7, 8]
    });
  });

  it("matches a non-contiguous subsequence in order", () => {
    const result = fuzzyMatch("hello world", "hlo");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 2, 4]);
    expect("hello world"[0]).toBe("h");
    expect("hello world"[2]).toBe("l");
    expect("hello world"[4]).toBe("o");
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("hello", "xyz")).toBeNull();
    expect(fuzzyMatch("abc", "cba")).toBeNull();
    expect(fuzzyMatch("ab", "abc")).toBeNull();
  });

  it("treats an empty query as a zero-score match", () => {
    expect(fuzzyMatch("anything", "")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("", "")).toEqual({ score: 0, positions: [] });
  });

  it("returns null for a non-empty query against empty text", () => {
    expect(fuzzyMatch("", "a")).toBeNull();
  });

  it("is case-insensitive by default", () => {
    const result = fuzzyMatch("HelloWorld", "hw");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 5]);
  });

  it("honors caseSensitive", () => {
    expect(fuzzyMatch("HelloWorld", "hw", { caseSensitive: true })).toBeNull();
    expect(fuzzyMatch("HelloWorld", "HW", { caseSensitive: true })).not.toBeNull();
  });

  it("always returns one position per query character, ascending and in bounds", () => {
    const text = "the quick brown fox";
    for (const query of ["tqbf", "brwn", "he", "x", "tf"]) {
      const result = fuzzyMatch(text, query);
      expect(result, query).not.toBeNull();
      const { positions } = result!;
      expect(positions).toHaveLength(query.length);
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(0);
        expect(positions[i]).toBeLessThan(text.length);
        if (i > 0) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    }
  });

  it("narrows to the tightest trailing window so late repeats win", () => {
    // Two 'b's: the tightest window for "bc" is the second 'b'.
    const result = fuzzyMatch("b__bc", "bc");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([3, 4]);
  });

  describe("scoring", () => {
    it("ranks a contiguous match above a scattered one", () => {
      expect(scoreOf("abc", "abc")).toBeGreaterThan(scoreOf("axbxc", "abc"));
    });

    it("rewards matches at a word boundary over mid-word matches", () => {
      expect(scoreOf(" b", "b")).toBeGreaterThan(scoreOf("ab", "b"));
      expect(scoreOf("foo bar", "bar")).toBeGreaterThan(scoreOf("foobar", "bar"));
    });

    it("rewards camelCase boundaries", () => {
      expect(scoreOf("fooBar", "fb")).toBeGreaterThan(scoreOf("foobar", "fb"));
    });
  });
});

describe("findFuzzyMatches", () => {
  it("returns an empty array for an empty query", () => {
    expect(findFuzzyMatches("one\ntwo\nthree", "")).toEqual([]);
  });

  it("finds one match per matching line with absolute document offsets", () => {
    const doc = "foo\nbar baz\nqux";
    const matches = findFuzzyMatches(doc, "bz");

    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match.line).toBe(1);
    expect(match.text).toBe("bar baz");
    expect(doc.slice(match.from, match.to)).toBe("baz");
    for (const pos of match.positions) {
      expect(pos).toBeGreaterThanOrEqual(match.from);
      expect(pos).toBeLessThan(match.to);
    }
    expect(match.positions.map((pos) => doc[pos]).join("")).toBe("bz");
  });

  it("skips lines that do not contain the subsequence", () => {
    const matches = findFuzzyMatches("apple\nbanana\ncherry", "an");
    expect(matches.map((m) => m.line)).toEqual([1]);
  });

  it("ranks the best match first", () => {
    const doc = "c-o-n-f-i-g\nconfig";
    const matches = findFuzzyMatches(doc, "config");

    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(1); // contiguous beats the gap-riddled line
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it("keeps offsets correct across multiple lines", () => {
    const doc = "alpha\nbeta\ngamma";
    const matches = findFuzzyMatches(doc, "gma");
    expect(matches).toHaveLength(1);
    expect(doc[matches[0].from]).toBe("g");
    expect(matches[0].positions.map((pos) => doc[pos]).join("")).toBe("gma");
  });

  it("honors caseSensitive", () => {
    expect(findFuzzyMatches("Config", "config", { caseSensitive: true })).toHaveLength(0);
    expect(findFuzzyMatches("Config", "Config", { caseSensitive: true })).toHaveLength(1);
  });
});
