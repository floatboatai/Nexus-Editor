import { describe, expect, it } from "vitest";

import {
  computeSlashState,
  filterSlashCommands,
  fuzzyScore,
  getSlashMatch,
} from "../src/slash-state";
import type { SlashCommandDef } from "../src/types";

function cmds(...defs: Array<Partial<SlashCommandDef> & { id: string; title: string }>): SlashCommandDef[] {
  return defs.map((d) => ({ ...d } as SlashCommandDef));
}

describe("getSlashMatch", () => {
  it("returns the trigger range when slash starts the line", () => {
    const doc = "/he";
    expect(getSlashMatch(doc, doc.length)).toEqual({ from: 0, to: 3, query: "he" });
  });

  it("returns the trigger range when slash follows whitespace", () => {
    const doc = "Hello /he";
    expect(getSlashMatch(doc, doc.length)).toEqual({ from: 6, to: 9, query: "he" });
  });

  it("ignores slash that is part of a path-like token", () => {
    expect(getSlashMatch("path/to", 7)).toBeNull();
  });

  it("ignores slash if the query already contains whitespace", () => {
    expect(getSlashMatch("/ab cd", 6)).toBeNull();
  });

  it("matches slash at start of line in a multi-line document", () => {
    const doc = "Line1\n/he";
    expect(getSlashMatch(doc, doc.length)).toEqual({ from: 6, to: 9, query: "he" });
  });
});

describe("filterSlashCommands ranking", () => {
  it("preserves registration order when the query is empty", () => {
    const list = cmds(
      { id: "table", title: "Table" },
      { id: "h1", title: "Heading 1" },
      { id: "bold", title: "Bold" },
    );
    expect(filterSlashCommands(list, "").map((c) => c.id)).toEqual([
      "table",
      "h1",
      "bold",
    ]);
  });

  it("ranks exact title match above prefix match", () => {
    const list = cmds(
      { id: "table-of-contents", title: "Table of Contents" },
      { id: "table", title: "Table" },
    );
    expect(filterSlashCommands(list, "table").map((c) => c.id)).toEqual([
      "table",
      "table-of-contents",
    ]);
  });

  it("ranks title prefix above keyword prefix", () => {
    const list = cmds(
      { id: "highlight", title: "Highlight", keywords: [] },
      { id: "heading", title: "Heading", keywords: ["h1"] },
    );
    // Query "h": both Title prefix → tiebreaker is title.length (Heading=7, Highlight=9),
    // so Heading wins.
    expect(filterSlashCommands(list, "h").map((c) => c.id)).toEqual([
      "heading",
      "highlight",
    ]);
  });

  it("ranks title-prefix above keyword-prefix when only one is a title hit", () => {
    const list = cmds(
      { id: "alpha", title: "Alpha", keywords: ["zeta"] },
      { id: "bravo", title: "Other", keywords: ["alphabet"] },
    );
    expect(filterSlashCommands(list, "alpha").map((c) => c.id)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  it("filters out non-matches entirely", () => {
    const list = cmds(
      { id: "heading", title: "Heading", keywords: ["title"] },
      { id: "table", title: "Table", keywords: ["grid"] },
    );
    expect(filterSlashCommands(list, "zzz")).toEqual([]);
  });

  it("ranks exact keyword above title substring", () => {
    const list = cmds(
      // "rule" appears in title as substring at index 5
      { id: "hr", title: "Page rule line", keywords: ["divider"] },
      { id: "rule-cmd", title: "Other", keywords: ["rule"] },
    );
    expect(filterSlashCommands(list, "rule").map((c) => c.id)).toEqual([
      "rule-cmd",
      "hr",
    ]);
  });

  it("is case-insensitive on both title and keywords", () => {
    const list = cmds(
      { id: "h1", title: "HEADING", keywords: ["TITLE"] },
    );
    expect(filterSlashCommands(list, "tit").map((c) => c.id)).toEqual(["h1"]);
    expect(filterSlashCommands(list, "head").map((c) => c.id)).toEqual(["h1"]);
  });

  it("returns deterministic order on identical scores", () => {
    const list = cmds(
      { id: "z", title: "Zeta" },
      { id: "a", title: "Alpha" },
    );
    // Empty query preserves input order.
    expect(filterSlashCommands(list, "").map((c) => c.id)).toEqual(["z", "a"]);
    // A query matching both via title-substring with identical
    // tiebreakers (offset 1) sorts alphabetically.
    const list2 = cmds(
      { id: "z", title: "Zoo" },
      { id: "a", title: "Aoo" },
    );
    expect(filterSlashCommands(list2, "oo").map((c) => c.id)).toEqual(["a", "z"]);
  });
});

describe("computeSlashState limit", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `cmd-${i}`,
    title: `Command ${i}`,
  }));

  it("caps the result at the default limit of 8", () => {
    const state = computeSlashState("/com", 4, many);
    expect(state.isOpen).toBe(true);
    expect(state.commands).toHaveLength(8);
  });

  it("honours an explicit limit option", () => {
    const state = computeSlashState("/com", 4, many, { limit: 3 });
    expect(state.commands).toHaveLength(3);
  });

  it("returns an empty list when limit is zero, keeping isOpen true", () => {
    const state = computeSlashState("/com", 4, many, { limit: 0 });
    expect(state.isOpen).toBe(true);
    expect(state.commands).toEqual([]);
  });

  it("uncaps when limit is negative", () => {
    const state = computeSlashState("/com", 4, many, { limit: -1 });
    expect(state.commands).toHaveLength(12);
  });

  it("applies limit AFTER ranking", () => {
    const list = cmds(
      { id: "later", title: "Later" },
      { id: "head1", title: "Heading 1" },
      { id: "head2", title: "Heading 2" },
      { id: "head3", title: "Heading 3" },
    );
    const state = computeSlashState("/h", 2, list, { limit: 2 });
    // All three "Heading N" share title-prefix tier; alphabetical ties
    // keep the original heading order. "Later" never matches "/h".
    expect(state.commands.map((c) => c.id)).toEqual(["head1", "head2"]);
  });
});

describe("computeSlashState closed state", () => {
  it("returns isOpen=false with empty commands when no slash trigger", () => {
    expect(computeSlashState("plain text", 10, cmds({ id: "h", title: "Heading" }))).toEqual({
      isOpen: false,
      from: null,
      to: null,
      query: "",
      commands: [],
    });
  });

  it("returns isOpen=true with empty commands for a non-matching query", () => {
    const state = computeSlashState("/zzz", 4, cmds({ id: "h", title: "Heading" }));
    expect(state.isOpen).toBe(true);
    expect(state.commands).toEqual([]);
    expect(state.query).toBe("zzz");
  });
});

// ─── fuzzyScore ─────────────────────────────────────────────────────

describe("fuzzyScore", () => {
  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  it("returns null when query is longer than target", () => {
    expect(fuzzyScore("ab", "abc")).toBeNull();
  });

  it("matches consecutive characters (exact prefix)", () => {
    const score = fuzzyScore("Heading", "he");
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(10 / 7);
  });

  it("matches scattered characters in order", () => {
    // "hd" matches 'h' at 0 and 'd' at 2 in "Heading"
    const score = fuzzyScore("Heading", "hd");
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it("returns null when characters don't appear in order", () => {
    expect(fuzzyScore("Heading", "dh")).toBeNull(); // 'd' before 'h'
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyScore("Heading", "hz")).toBeNull(); // 'z' not in "Heading"
  });

  it("bonuses consecutive matches over scattered ones", () => {
    // "ad" appears consecutively at positions 2,3 in "Heading"
    const consecutive = fuzzyScore("Heading", "ad");
    // "ag" is scattered (positions 2,6)
    const scattered = fuzzyScore("Heading", "ag");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!).toBeGreaterThan(scattered!);
  });

  it("bonuses word boundary matches", () => {
    // "odb": 'o' at 1, 'd' at 3, 'b' at 5 (word boundary after space)
    const withBoundary = fuzzyScore("Code Block", "odb");
    // "odb" in "codeblock" — 'b' at 4 is camelCase but no word boundary
    const noBoundary = fuzzyScore("codeblock", "odb");
    expect(withBoundary).not.toBeNull();
    expect(noBoundary).not.toBeNull();
    // Word boundary bonus (+8) > camelCase bonus (+6)
    expect(withBoundary!).toBeGreaterThan(noBoundary!);
  });

  it("bonuses start-of-string match", () => {
    // "Cod" starts at position 0 in "Code Block"
    const atStart = fuzzyScore("Code Block", "cod");
    // "Blo" starts at position 5
    const notAtStart = fuzzyScore("Code Block", "blo");
    expect(atStart).not.toBeNull();
    expect(notAtStart).not.toBeNull();
    expect(atStart!).toBeGreaterThan(notAtStart!);
  });

  it("normalises by target length (prefers shorter targets)", () => {
    // Both "abc" and "abcxyz" contain "a" and "b"
    const shorter = fuzzyScore("ab", "ab");
    const longer = fuzzyScore("ab-de-extra-text", "ab");
    expect(shorter).not.toBeNull();
    expect(longer).not.toBeNull();
    expect(shorter!).toBeGreaterThan(longer!);
  });

  it("bonuses camelCase boundaries", () => {
    // "T" in "TableOfContents" follows a lowercase 'e' (camelCase boundary)
    const camel = fuzzyScore("TableOfContents", "et"); // 'e' then 'T' at camelCase boundary
    expect(camel).not.toBeNull();
    expect(camel!).toBeGreaterThan(0);
  });
});

// ─── filterSlashCommands with fuzzy=true ────────────────────────────

describe("filterSlashCommands fuzzy matching", () => {
  it("finds fuzzy title match when no exact or substring match exists", () => {
    const list = cmds(
      { id: "heading", title: "Heading" },
      { id: "table", title: "Table" },
    );
    // "hd" is not a substring of "Heading" but is a fuzzy match
    expect(filterSlashCommands(list, "hd").map((c) => c.id)).toEqual([
      "heading",
    ]);
  });

  it("ranks exact/stricter matches above fuzzy matches", () => {
    const list = cmds(
      { id: "fuzzy-match", title: "SomeToolBar", keywords: [] },
      { id: "exact-match", title: "Tool", keywords: [] },
      { id: "prefix-match", title: "ToolBox", keywords: [] },
    );
    const result = filterSlashCommands(list, "tool");
    // "Tool" is exact → "ToolBox" is prefix → "SomeToolBar" is fuzzy
    expect(result.map((c) => c.id)).toEqual([
      "exact-match",
      "prefix-match",
      "fuzzy-match",
    ]);
  });

  it("finds fuzzy keyword match as lower priority", () => {
    const list = cmds(
      { id: "h1", title: "Heading 1", keywords: ["header", "title"] },
      { id: "code", title: "Code Block", keywords: ["script"] },
    );
    // "tt" is not a substring of any title, but it fuzzy-matches "title" keyword
    const result = filterSlashCommands(list, "tt");
    expect(result.map((c) => c.id)).toEqual(["h1"]);
  });

  it("ranks fuzzy title above fuzzy keyword", () => {
    const list = cmds(
      { id: "kw-only", title: "Zebra", keywords: ["bolt"] },
      { id: "title-match", title: "Bolt Text", keywords: [] },
    );
    // "bol" fuzzy matches "Bolt Text" title AND "bolt" keyword
    // Fuzzy title tier (500) always ranks above fuzzy keyword tier (250)
    const result = filterSlashCommands(list, "bol");
    expect(result.map((c) => c.id)).toEqual(["title-match", "kw-only"]);
  });

  it("ranks better-quality fuzzy matches above worse ones", () => {
    const list = cmds(
      { id: "scattered", title: "Foo Xml Bar", keywords: [] },
      { id: "compact", title: "FooBar", keywords: [] },
    );
    // Both fuzzy-match "fbar", but "FooBar" has consecutive matches and is shorter
    const result = filterSlashCommands(list, "fbar");
    expect(result.map((c) => c.id)).toEqual(["compact", "scattered"]);
  });

  it("fuzzy matches by default without needing an option", () => {
    const list = cmds(
      { id: "heading", title: "Heading" },
    );
    // Fuzzy always on — "hd" should find "Heading"
    expect(filterSlashCommands(list, "hd").map(c => c.id)).toEqual(["heading"]);
  });

  it("fuzzy does NOT override stricter matches", () => {
    const list = cmds(
      { id: "h1", title: "Heading 1", keywords: ["title"] },
      { id: "code", title: "Code Block" },
    );
    // "he" is a title-prefix match for "Heading 1"
    // "Code Block" wouldn't fuzzy-match "he" (no 'e' after 'h')
    const result = filterSlashCommands(list, "he");
    expect(result.map(c => c.id)).toEqual(["h1"]);
  });

  it("fuzzy query that matches nothing returns empty array", () => {
    const list = cmds(
      { id: "h1", title: "Heading" },
      { id: "code", title: "Code" },
    );
    expect(filterSlashCommands(list, "xyz")).toEqual([]);
  });

  it("handles empty command list with fuzzy enabled", () => {
    expect(filterSlashCommands([], "any")).toEqual([]);
  });
});

// ─── computeSlashState (fuzzy always on) ────────────────────────────

describe("computeSlashState", () => {
  it("fuzzy matches by default", () => {
    const list = cmds(
      { id: "heading", title: "Heading" },
      { id: "table", title: "Table" },
    );
    const state = computeSlashState("/hd", 3, list);
    expect(state.isOpen).toBe(true);
    expect(state.commands.map((c) => c.id)).toEqual(["heading"]);
  });

  it("fuzzy matches when no options passed", () => {
    const list = cmds(
      { id: "heading", title: "Heading" },
    );
    const state = computeSlashState("/hd", 3, list);
    expect(state.isOpen).toBe(true);
    expect(state.commands.map((c) => c.id)).toEqual(["heading"]);
  });

  it("combines fuzzy with limit correctly", () => {
    const list = cmds(
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
      { id: "c", title: "Gamma" },
    );
    // All three fuzzy-match "a" (single char), limit to 2
    const state = computeSlashState("/a", 2, list, { limit: 2 });
    expect(state.commands).toHaveLength(2);
  });
});
