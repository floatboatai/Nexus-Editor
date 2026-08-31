import { describe, expect, it } from "vitest";

import {
  buildFuzzyAlternationPattern,
  findFuzzyMatches
} from "../src/fuzzy";
import { findSearchMatches, replaceAllMatches } from "../src/index";

describe("fuzzy search", () => {
  it("matches query characters as an ordered subsequence", () => {
    expect(findFuzzyMatches("Hello World", "hwd")).toEqual([
      { from: 0, to: 11, text: "Hello World" }
    ]);
  });

  it("finds multiple non-overlapping fuzzy matches", () => {
    expect(findFuzzyMatches("abc abc", "ac")).toEqual([
      { from: 0, to: 3, text: "abc" },
      { from: 4, to: 7, text: "abc" }
    ]);
  });

  it("uses the shortest span for each match start", () => {
    expect(findFuzzyMatches("hello", "hl")).toEqual([{ from: 0, to: 3, text: "hel" }]);
  });

  it("supports case-insensitive fuzzy matching by default", () => {
    expect(findFuzzyMatches("Hello HELLO", "hlo")).toEqual([
      { from: 0, to: 5, text: "Hello" },
      { from: 6, to: 11, text: "HELLO" }
    ]);
  });

  it("supports case-sensitive fuzzy matching", () => {
    expect(findFuzzyMatches("Hello hello", "hlo", { caseSensitive: true })).toEqual([
      { from: 6, to: 11, text: "hello" }
    ]);
  });

  it("returns no matches when the subsequence cannot be found", () => {
    expect(findFuzzyMatches("hello", "hz")).toEqual([]);
  });

  it("builds a regex alternation pattern from unique match texts", () => {
    expect(
      buildFuzzyAlternationPattern([
        { from: 0, to: 3, text: "Hel" },
        { from: 6, to: 9, text: "Hel" }
      ])
    ).toBe("Hel");
  });

  it("escapes regex metacharacters in fuzzy alternation patterns", () => {
    expect(
      buildFuzzyAlternationPattern([{ from: 0, to: 4, text: "a.b(" }])
    ).toBe("a\\.b\\(");
  });
});

describe("findSearchMatches fuzzy option", () => {
  it("delegates to fuzzy matching when fuzzy is enabled", () => {
    expect(findSearchMatches("function renderComponent", "frc", { fuzzy: true })).toEqual([
      { from: 0, to: 16, text: "function renderC" }
    ]);
  });

  it("replaces all fuzzy matches from end to start", () => {
    expect(replaceAllMatches("abc xyz abc", "ac", "!", { fuzzy: true })).toBe("! xyz !");
  });
});
