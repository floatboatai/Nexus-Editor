import { describe, expect, it } from "vitest";

import {
  computeSlashState,
  filterSlashCommands,
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
