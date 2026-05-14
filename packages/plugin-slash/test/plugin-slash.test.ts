import { describe, expect, it } from "vitest";
import {
  createSlashPlugin,
  filterSlashCommands,
  getSlashState,
  getSlashMatch
} from "../src/index";

describe("@floatboat/nexus-plugin-slash", () => {
  it("detects a slash query at the cursor position", () => {
    const doc = "Before\n/hea";

    expect(getSlashMatch(doc, doc.length)).toEqual({
      from: 7,
      to: 11,
      query: "hea"
    });
  });

  it("ignores slashes that are part of a word", () => {
    const doc = "path/to";

    expect(getSlashMatch(doc, doc.length)).toBeNull();
  });

  it("filters slash commands by title and keywords", () => {
    const commands = [
      { id: "heading", title: "Heading", keywords: ["title", "h1"] },
      { id: "table", title: "Table", keywords: ["grid"] }
    ];

    expect(filterSlashCommands(commands, "tit").map((command) => command.id)).toEqual([
      "heading"
    ]);
    expect(filterSlashCommands(commands, "grid").map((command) => command.id)).toEqual(["table"]);
  });

  it("creates a slash plugin that preserves command definitions", () => {
    const commands = [{ id: "heading", title: "Heading" }];
    const plugin = createSlashPlugin(commands);

    expect(plugin.name).toBe("plugin-slash");
    expect("slashCommands" in plugin ? plugin.slashCommands : undefined).toEqual(commands);
  });

  it("derives slash menu state with filtered commands", () => {
    const commands = [
      { id: "heading", title: "Heading", keywords: ["title"] },
      { id: "table", title: "Table", keywords: ["grid"] }
    ];
    const doc = "/tit";

    expect(getSlashState(doc, doc.length, commands)).toEqual({
      isOpen: true,
      from: 0,
      to: 4,
      query: "tit",
      commands: [{ id: "heading", title: "Heading", keywords: ["title"] }]
    });
  });

  it("returns a closed slash menu state when no slash query is active", () => {
    expect(getSlashState("plain text", 10, [{ id: "heading", title: "Heading" }])).toEqual({
      isOpen: false,
      from: null,
      to: null,
      query: "",
      commands: []
    });
  });
  // ── Sorting and Limit ──

   it("sorts commands by priority when no query", () => {
    const commands = [
      { id: "b", title: "B", priority: 1 },
      { id: "a", title: "A", priority: 10 },
      { id: "c", title: "C", priority: 5 }
    ];

    const result = filterSlashCommands(commands, "");
    expect(result.map((cmd) => cmd.id)).toEqual(["a", "c", "b"]);
  });

  it("limits the number of returned commands", () => {
    const commands = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
      { id: "e", title: "E" },
      { id: "f", title: "F" },
      { id: "g", title: "G" },
      { id: "h", title: "H" },
      { id: "i", title: "I" },
      { id: "j", title: "J" },
      { id: "k", title: "K" }
    ];

    const result = filterSlashCommands(commands, "");
    expect(result.length).toBe(10); // Default limit
    expect(result.map((cmd) => cmd.id)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  });

  it("respects custom limit option", () => {
    const commands = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" }
    ];

    const result = filterSlashCommands(commands, "", { limit: 2 });
    expect(result.length).toBe(2);
    expect(result.map((cmd) => cmd.id)).toEqual(["a", "b"]);
  });

  it("sorts by match score with title exact match first", () => {
    const commands = [
      { id: "contains", title: "My Heading" },
      { id: "exact", title: "Heading" },
      { id: "starts", title: "Heading Style" }
    ];

    const result = filterSlashCommands(commands, "heading");
    expect(result.map((cmd) => cmd.id)).toEqual(["exact", "starts", "contains"]);
  });

  it("sorts by match score with keyword match", () => {
    const commands = [
      { id: "title", title: "Title", keywords: ["heading"] },
      { id: "exact", title: "Heading" },
      { id: "keyword", title: "Other", keywords: ["heading"] }
    ];

    const result = filterSlashCommands(commands, "heading");
    // Exact title match > title starts with > keyword match
    expect(result.map((cmd) => cmd.id)).toEqual(["exact", "title", "keyword"]);
  });

  it("applies priority bonus to match score", () => {
    const commands = [
      { id: "low", title: "Heading" },
      { id: "high", title: "My Heading", priority: 50 }
    ];

    const result = filterSlashCommands(commands, "heading");
    // "My Heading" has lower base score (contains) but higher priority bonus
    // Score: low=60, high=60+50=110
    expect(result.map((cmd) => cmd.id)).toEqual(["high", "low"]);
  });

  it("filters and limits with query", () => {
    const commands = [
      { id: "a", title: "Apple" },
      { id: "b", title: "Banana" },
      { id: "c", title: "Cherry" },
      { id: "d", title: "Date" },
      { id: "e", title: "Elderberry" }
    ];

    const result = filterSlashCommands(commands, "a", { limit: 2 });
    expect(result.length).toBe(2);
    // "Apple" (starts with) > "Banana" (contains) > "Date" (contains)
    expect(result.map((cmd) => cmd.id)).toEqual(["a", "b"]);
  });

  // Main 分支新增用例
  it("ranks title-prefix matches above keyword-only matches", () => {
    const commands = [
      { id: "highlight", title: "Highlight" },
      { id: "heading", title: "Heading", keywords: ["h1"] }
    ];
    // Title prefix tier; "Heading" (7 chars) wins over "Highlight" (9 chars).
    expect(filterSlashCommands(commands, "h").map((c) => c.id)).toEqual([
      "heading",
      "highlight"
    ]);
  });

  it("propagates limit through getSlashState", () => {
    const commands = Array.from({ length: 10 }, (_, i) => ({
      id: `cmd-${i}`,
      title: `Command ${i}`
    }));
    const state = getSlashState("/com", 4, commands, { limit: 2 });
    expect(state.commands).toHaveLength(2);
  });

  it("preserves an optional run callback through filterSlashCommands", () => {
    const run = () => true;
    const filtered = filterSlashCommands(
      [{ id: "h1", title: "Heading 1", run }],
      "head"
    );
    expect(filtered[0].run).toBe(run);
  });
});
