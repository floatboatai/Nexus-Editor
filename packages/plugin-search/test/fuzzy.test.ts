import { describe, expect, it } from "vitest";
import {
  findFuzzySearchMatches,
  findSearchMatches,
  replaceAllMatches,
  fuzzyMatch
} from "../src/index";

describe("@floatboat/nexus-plugin-search fuzzy matching", () => {
  it("matches ordered characters", () => {
    expect(fuzzyMatch("nme", "Nexus Markdown Editor")?.positions).toEqual([0, 6, 15]);
  });

  it("does not match out-of-order characters", () => {
    expect(fuzzyMatch("nme", "Markdown Nexus Editor")).toBeNull();
  });

  it("supports case-sensitive matching", () => {
    expect(fuzzyMatch("NE", "Nexus Editor", { caseSensitive: true })?.positions).toEqual([0, 6]);
    expect(fuzzyMatch("ne", "Nexus Editor", { caseSensitive: true })).toBeNull();
  });

  it("prefers consecutive matches over earlier sparse matches", () => {
    expect(fuzzyMatch("ab", "axxxab")?.positions).toEqual([4, 5]);
  });

  it("rewards word boundary matches", () => {
    const compact = fuzzyMatch("me", "markdowneditor");
    const boundary = fuzzyMatch("me", "Markdown Editor");

    expect(compact).not.toBeNull();
    expect(boundary).not.toBeNull();
    expect(boundary!.score).toBeGreaterThan(compact!.score);
  });

  it("matches CJK characters", () => {
    expect(fuzzyMatch("编辑", "Nexus 编辑器")?.positions).toEqual([6, 7]);
  });

  it("finds fuzzy matches through findSearchMatches", () => {
    expect(findSearchMatches("Nexus Markdown", "nm", { fuzzy: true })).toEqual([
      {
        from: 0,
        to: 7,
        text: "Nexus M",
        score: expect.any(Number),
        positions: [0, 6]
      }
    ]);
  });

  it("sorts fuzzy matches by score before document position", () => {
    const matches = findFuzzySearchMatches("Alpha\nApple", "ap");

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      from: 6,
      to: 8,
      text: "Ap",
      positions: [6, 7]
    });
  });

  it("limits fuzzy results with maxResults", () => {
    const matches = findSearchMatches("Alpha\nAlpine\nApple", "ap", {
      fuzzy: true,
      maxResults: 2
    });

    expect(matches).toHaveLength(2);
  });

  it("handles maxResults edge cases", () => {
    const doc = "Alpha\nAlpine\nApple";

    expect(findSearchMatches(doc, "ap", { fuzzy: true, maxResults: 0 })).toEqual([]);
    expect(findSearchMatches(doc, "ap", { fuzzy: true, maxResults: -1 })).toEqual([]);
    expect(findSearchMatches(doc, "ap", { fuzzy: true, maxResults: 1.8 })).toHaveLength(1);
    expect(findSearchMatches(doc, "ap", { fuzzy: true, maxResults: Number.NaN })).toHaveLength(3);
  });

  it("keeps CRLF line endings out of fuzzy candidates", () => {
    expect(findSearchMatches("Alpha\r\nApple", "ap", { fuzzy: true })).toEqual([
      {
        from: 7,
        to: 9,
        text: "Ap",
        score: expect.any(Number),
        positions: [7, 8]
      },
      {
        from: 0,
        to: 3,
        text: "Alp",
        score: expect.any(Number),
        positions: [0, 2]
      }
    ]);
  });

  it("returns no matches when fuzzy and regexp are both enabled", () => {
    expect(findSearchMatches("abc", "a.c", { fuzzy: true, regexp: true })).toEqual([]);
  });

  it("leaves replaceAll unchanged when fuzzy mode is requested", () => {
    expect(replaceAllMatches("Nexus Markdown", "nm", "x", { fuzzy: true })).toBe("Nexus Markdown");
  });

  it("searches word candidates when wholeWord and fuzzy are combined", () => {
    expect(findSearchMatches("Nexus Markdown Editor", "nme", { fuzzy: true, wholeWord: true })).toEqual([]);
    expect(findSearchMatches("NexusEditor Markdown", "ne", { fuzzy: true, wholeWord: true })).toEqual([
      {
        from: 0,
        to: 2,
        text: "Ne",
        score: expect.any(Number),
        positions: [0, 1]
      }
    ]);
  });
});
