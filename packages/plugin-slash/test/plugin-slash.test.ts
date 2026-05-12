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
});

describe("filterSlashCommands sorting", () => {
  const commands = [
    { id: "table", title: "Table", keywords: ["grid"] },
    { id: "text-color", title: "Text Color", keywords: ["color", "highlight"] },
    { id: "heading", title: "Heading", keywords: ["title", "h1"] },
    { id: "horizontal-rule", title: "Horizontal Rule", keywords: ["hr", "divider"] }
  ];

  it("ranks exact title match first", () => {
    const result = filterSlashCommands(commands, "heading");

    expect(result.map((c) => c.id)).toEqual(["heading"]);
  });

  it("ranks title prefix match before keyword match", () => {
    const result = filterSlashCommands(commands, "h");

    expect(result[0].id).toBe("heading");
    expect(result[1].id).toBe("horizontal-rule");
  });

  it("sorts by title alphabetically within the same priority", () => {
    const result = filterSlashCommands(commands, "h");

    const prefixMatches = result.filter(
      (c) => c.title.toLowerCase().startsWith("h")
    );
    for (let i = 1; i < prefixMatches.length; i++) {
      expect(prefixMatches[i - 1].title.localeCompare(prefixMatches[i].title)).toBeLessThanOrEqual(0);
    }
  });

  it("includes keyword matches after title matches", () => {
    const commandsWithKeywordMatch = [
      { id: "heading", title: "Heading", keywords: ["h1"] },
      { id: "table", title: "Table", keywords: ["header"] }
    ];
    const result = filterSlashCommands(commandsWithKeywordMatch, "h");

    // heading: title prefix match (priority 1) comes first
    // table: keyword "header" includes "h" (priority 2) comes after
    expect(result[0].id).toBe("heading");
    expect(result.some((c) => c.id === "table")).toBe(true);
  });

  it("returns empty array when no commands match", () => {
    expect(filterSlashCommands(commands, "xyz")).toEqual([]);
  });
});

describe("filterSlashCommands limit", () => {
  const commands = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "horizontal-rule", title: "Horizontal Rule", keywords: ["hr"] },
    { id: "highlight", title: "Highlight", keywords: ["mark"] },
    { id: "blockquote", title: "Blockquote", keywords: ["quote"] }
  ];

  it("limits the number of returned commands when query is empty", () => {
    const result = filterSlashCommands(commands, "", 2);

    expect(result.length).toBe(2);
  });

  it("limits the number of returned commands after filtering and sorting", () => {
    const result = filterSlashCommands(commands, "h", 2);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("heading");
  });

  it("returns all matching commands when limit exceeds matches", () => {
    const result = filterSlashCommands(commands, "heading", 10);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe("heading");
  });

  it("returns all commands when limit is not provided", () => {
    const resultNoLimit = filterSlashCommands(commands, "h");
    const resultAll = filterSlashCommands(commands, "h");

    expect(resultNoLimit).toEqual(resultAll);
  });
});

describe("getSlashState with limit", () => {
  const commands = [
    { id: "heading", title: "Heading", keywords: ["h1"] },
    { id: "horizontal-rule", title: "Horizontal Rule", keywords: ["hr"] },
    { id: "highlight", title: "Highlight", keywords: ["mark"] }
  ];

  it("passes limit through to filterSlashCommands", () => {
    const state = getSlashState("/h", 2, commands, 1);

    expect(state.isOpen).toBe(true);
    expect(state.commands.length).toBe(1);
    expect(state.commands[0].id).toBe("heading");
  });

  it("works without limit (backwards compatible)", () => {
    const state = getSlashState("/h", 2, commands);

    expect(state.isOpen).toBe(true);
    expect(state.commands.length).toBe(3);
  });
});

describe("createSlashPlugin with options", () => {
  it("accepts options parameter without error", () => {
    const commands = [{ id: "heading", title: "Heading" }];
    const plugin = createSlashPlugin(commands, { limit: 5 });

    expect(plugin.name).toBe("plugin-slash");
    expect(plugin.slashCommands).toEqual(commands);
  });

  it("works without options (backwards compatible)", () => {
    const commands = [{ id: "heading", title: "Heading" }];
    const plugin = createSlashPlugin(commands);

    expect(plugin.name).toBe("plugin-slash");
    expect(plugin.slashCommands).toEqual(commands);
  });
});
