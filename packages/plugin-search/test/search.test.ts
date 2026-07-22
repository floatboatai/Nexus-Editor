import { describe, expect, it } from "vitest";

import { findSearchMatches, replaceAllMatches, type SearchMatch } from "../src/index";

const match = (from: number, to: number, text: string): SearchMatch => ({ from, to, text });

describe("findSearchMatches — literal search", () => {
  it("finds all occurrences of a literal string", () => {
    expect(findSearchMatches("hello hello world", "hello")).toEqual([
      match(0, 5, "hello"),
      match(6, 11, "hello")
    ]);
  });

  it("returns empty array for empty query", () => {
    expect(findSearchMatches("hello", "")).toEqual([]);
  });

  it("returns empty array when no match exists", () => {
    expect(findSearchMatches("hello", "xyz")).toEqual([]);
  });

  it("matches case-insensitively by default", () => {
    expect(findSearchMatches("Hello HELLO", "hello")).toHaveLength(2);
  });

  it("respects caseSensitive option", () => {
    expect(findSearchMatches("Hello HELLO", "hello", { caseSensitive: true })).toHaveLength(0);
    expect(findSearchMatches("Hello HELLO", "Hello", { caseSensitive: true })).toHaveLength(1);
  });
});

describe("findSearchMatches — wholeWord", () => {
  it("matches whole words only", () => {
    expect(findSearchMatches("cat category cat", "cat", { wholeWord: true })).toEqual([
      match(0, 3, "cat"),
      match(13, 16, "cat")
    ]);
  });

  it("does not match substrings", () => {
    expect(findSearchMatches("category", "cat", { wholeWord: true })).toEqual([]);
  });
});

describe("findSearchMatches — regexp", () => {
  it("matches using a regular expression", () => {
    expect(findSearchMatches("a1b2c3", "\\d", { regexp: true })).toHaveLength(3);
  });

  it("respects caseSensitive with regexp", () => {
    expect(findSearchMatches("aAbB", "a", { regexp: true, caseSensitive: true })).toHaveLength(1);
  });

  it("returns empty array for an invalid regexp", () => {
    expect(findSearchMatches("hello", "(", { regexp: true })).toEqual([]);
  });
});

describe("findSearchMatches — fuzzy mode", () => {
  it("finds fuzzy subsequence matches", () => {
    const matches = findSearchMatches("fuzzy search", "fzs", { fuzzy: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(7);
    expect(matches[0].text).toBe("fuzzy s");
  });

  it("returns SearchMatch[] without score or positions", () => {
    const matches = findSearchMatches("hello", "hlo", { fuzzy: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(match(0, 5, "hello"));
    expect("score" in matches[0]).toBe(false);
    expect("positions" in matches[0]).toBe(false);
  });

  it("returns empty array for empty query in fuzzy mode", () => {
    expect(findSearchMatches("hello", "", { fuzzy: true })).toEqual([]);
  });

  it("finds multiple non-overlapping fuzzy matches", () => {
    const matches = findSearchMatches("foo bar foo", "fo", { fuzzy: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].from).toBe(0);
    expect(matches[1].from).toBe(8);
  });

  it("respects caseSensitive in fuzzy mode", () => {
    expect(findSearchMatches("Hello HELLO", "Hlo", { fuzzy: true, caseSensitive: true })).toHaveLength(1);
  });

  it("respects fuzzyMaxGap option", () => {
    const doc = "a" + " ".repeat(100) + "b ab";
    const matches = findSearchMatches(doc, "ab", { fuzzy: true, fuzzyMaxGap: 64 });
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(103);
  });
});

describe("replaceAllMatches — literal replace", () => {
  it("replaces all occurrences", () => {
    expect(replaceAllMatches("hello hello", "hello", "hi")).toBe("hi hi");
  });

  it("returns the original for empty query", () => {
    expect(replaceAllMatches("hello", "", "x")).toBe("hello");
  });

  it("returns the original when no match exists", () => {
    expect(replaceAllMatches("hello", "xyz", "abc")).toBe("hello");
  });

  it("respects caseSensitive option", () => {
    expect(replaceAllMatches("Hello hello", "Hello", "Hi", { caseSensitive: true })).toBe(
      "Hi hello"
    );
  });
});

describe("replaceAllMatches — regexp replace", () => {
  it("replaces using a regular expression", () => {
    expect(replaceAllMatches("a1b2c3", "\\d", "0", { regexp: true })).toBe("a0b0c0");
  });

  it("returns the original for an invalid regexp", () => {
    expect(replaceAllMatches("hello", "(", "x", { regexp: true })).toBe("hello");
  });
});

describe("replaceAllMatches — fuzzy replace", () => {
  it("replaces all fuzzy match windows", () => {
    const result = replaceAllMatches("fuzzy search", "fzs", "[FZS]", { fuzzy: true });
    expect(result).toBe("[FZS]earch");
  });

  it("preserves text between non-overlapping matches", () => {
    const result = replaceAllMatches("foo bar foo", "fo", "X", { fuzzy: true });
    expect(result).toBe("Xo bar Xo");
  });

  it("returns the original when no fuzzy match exists", () => {
    expect(replaceAllMatches("hello", "xyz", "abc", { fuzzy: true })).toBe("hello");
  });

  it("returns the original for empty query in fuzzy mode", () => {
    expect(replaceAllMatches("hello", "", "x", { fuzzy: true })).toBe("hello");
  });

  it("respects caseSensitive in fuzzy mode", () => {
    const result = replaceAllMatches("Hello HELLO", "Hlo", "X", {
      fuzzy: true,
      caseSensitive: true
    });
    expect(result).toBe("X HELLO");
  });
});
