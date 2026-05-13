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

  it("sorts commands by priority (higher first)", () => {
    const commands = [
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Beta", priority: 3 },
      { id: "c", title: "Gamma", priority: 2 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts same-priority commands by title alphabetically", () => {
    const commands = [
      { id: "c", title: "Charlie", priority: 1 },
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Bravo", priority: 1 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("respects priority over title sort", () => {
    const commands = [
      { id: "z", title: "Zebra", priority: 10 },
      { id: "a", title: "Alpha", priority: 0 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["z", "a"]);
  });

  it("treats missing priority as 0", () => {
    const commands = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Bravo", priority: 5 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("limits results to maxResults", () => {
    const commands = [
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Bravo", priority: 2 },
      { id: "c", title: "Charlie", priority: 3 },
    ];

    const result = filterSlashCommands(commands, "", 2);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["c", "b"]);
  });

  it("returns all results when maxResults is not provided", () => {
    const commands = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Bravo" },
      { id: "c", title: "Charlie" },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result).toHaveLength(3);
  });

  it("sorts and limits filtered results (all three compose)", () => {
    const commands = [
      { id: "table", title: "Table", priority: 3 },
      { id: "code", title: "Code Block", priority: 2 },
      { id: "link", title: "Link" },
      { id: "list", title: "List", priority: 2 },
    ];

    const result = filterSlashCommands(commands, "l", 2);

    expect(result).toHaveLength(2);
    // Scoring: "Link"(prefix,5000) "List"(prefix,5000) "Table"(substring,3000) "Code Block"(substring,3000)
    // Then priority: Table(3,3000) List(2,5000) Code Block(2,3000) Link(0,5000)
    // Limited to 2: Table, List
    expect(result.map((c) => c.id)).toEqual(["table", "list"]);
  });

  it("handles empty command list gracefully", () => {
    const result = filterSlashCommands([], "", 5);
    expect(result).toEqual([]);
  });
});
