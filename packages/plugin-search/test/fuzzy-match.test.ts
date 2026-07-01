import { describe, expect, it } from "vitest";

import {
  findAllFuzzyMatchesInText,
  findBestFuzzyMatch,
  findFuzzyMatchesInDocument,
  MAX_FUZZY_PATTERN_LENGTH,
  MAX_FUZZY_TOKEN_LENGTH
} from "../src/fuzzy-match";

describe("findBestFuzzyMatch", () => {
  it("matches a scattered subsequence inside one token", () => {
    const match = findBestFuzzyMatch("Nexus-Editor", "nxed");
    expect(match).not.toBeNull();
    expect(match!.from).toBe(0);
    expect(match!.to).toBe(8);
  });

  it("prefers tighter spans when multiple paths exist", () => {
    const match = findBestFuzzyMatch("catalog concatenate", "cat");
    expect(match).not.toBeNull();
    expect(match!.from).toBe(0);
    expect(match!.to).toBe(3);
  });

  it("is case-insensitive by default", () => {
    const match = findBestFuzzyMatch("Alpha BETA", "ab");
    expect(match).not.toBeNull();
    expect(match!.from).toBe(4);
    expect(match!.to).toBe(7);
  });

  it("honors caseSensitive when enabled", () => {
    expect(findBestFuzzyMatch("Alpha BETA", "ab", { caseSensitive: true })).toBeNull();
    const match = findBestFuzzyMatch("Alpha BETA", "AB", { caseSensitive: true });
    expect(match).not.toBeNull();
    expect(match!.from).toBe(0);
    expect(match!.to).toBe(7);
  });

  it("returns null when the subsequence cannot be satisfied", () => {
    expect(findBestFuzzyMatch("hello", "hz")).toBeNull();
  });
});

describe("findAllFuzzyMatchesInText", () => {
  it("returns multiple non-overlapping spans in one token", () => {
    const matches = findAllFuzzyMatchesInText("tester", "te");
    expect(matches.map((match) => [match.from, match.to])).toEqual([
      [0, 2],
      [3, 5]
    ]);
  });
});

describe("findFuzzyMatchesInDocument", () => {
  it("matches tokens independently and skips whitespace", () => {
    const matches = findFuzzyMatchesInDocument("float boat ai\nNexus-Editor", "nxed");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      from: 14,
      to: 26,
      text: "Nexus-Editor"
    });
  });

  it("highlights the full token that contains the subsequence", () => {
    const matches = findFuzzyMatchesInDocument("next Text", "ext");
    expect(matches.map((match) => match.text)).toEqual(["next", "Text"]);
  });

  it("finds multiple tokens in one document", () => {
    const matches = findFuzzyMatchesInDocument("catalog concatenate", "cat");
    expect(matches.map((match) => match.text)).toEqual(["catalog", "concatenate"]);
  });

  it("rejects patterns longer than the safety cap", () => {
    const longPattern = "a".repeat(MAX_FUZZY_PATTERN_LENGTH + 1);
    expect(findBestFuzzyMatch("alphabet", longPattern)).toBeNull();
    expect(findFuzzyMatchesInDocument("alphabet", longPattern)).toEqual([]);
  });

  it("skips tokens longer than the safety cap", () => {
    const longToken = "a".repeat(MAX_FUZZY_TOKEN_LENGTH + 1);
    expect(findFuzzyMatchesInDocument(`${longToken} beta`, "b")).toEqual([
      {
        from: longToken.length + 1,
        to: longToken.length + 5,
        text: "beta"
      }
    ]);
  });
});
