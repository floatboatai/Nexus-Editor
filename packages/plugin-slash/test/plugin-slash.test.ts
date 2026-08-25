import { describe, expect, it } from "vitest";
import {
  createSlashPlugin,
  defaultSlashCommands,
  filterSlashCommands,
  getSlashState,
  getSlashMatch,
} from "../src/index";

describe("@floatboat/nexus-plugin-slash", () => {
  it("detects a slash query at the cursor position", () => {
    const doc = "Before\n/hea";

    expect(getSlashMatch(doc, doc.length)).toEqual({
      from: 7,
      to: 11,
      query: "hea",
    });
  });

  it("ignores slashes that are part of a word", () => {
    const doc = "path/to";

    expect(getSlashMatch(doc, doc.length)).toBeNull();
  });

  it("filters slash commands by title and keywords", () => {
    const commands = [
      { id: "heading", title: "Heading", keywords: ["title", "h1"] },
      { id: "table", title: "Table", keywords: ["grid"] },
    ];

    expect(
      filterSlashCommands(commands, "tit").map((command) => command.id),
    ).toEqual(["heading"]);
    expect(
      filterSlashCommands(commands, "grid").map((command) => command.id),
    ).toEqual(["table"]);
  });

  it("creates a slash plugin that preserves command definitions", () => {
    const commands = [{ id: "heading", title: "Heading" }];
    const plugin = createSlashPlugin(commands);

    expect(plugin.name).toBe("plugin-slash");
    expect(
      "slashCommands" in plugin ? plugin.slashCommands : undefined,
    ).toEqual(commands);
  });

  it("derives slash menu state with filtered commands", () => {
    const commands = [
      { id: "heading", title: "Heading", keywords: ["title"] },
      { id: "table", title: "Table", keywords: ["grid"] },
    ];
    const doc = "/tit";

    expect(getSlashState(doc, doc.length, commands)).toEqual({
      isOpen: true,
      from: 0,
      to: 4,
      query: "tit",
      commands: [{ id: "heading", title: "Heading", keywords: ["title"] }],
    });
  });

  it("returns a closed slash menu state when no slash query is active", () => {
    expect(
      getSlashState("plain text", 10, [{ id: "heading", title: "Heading" }]),
    ).toEqual({
      isOpen: false,
      from: null,
      to: null,
      query: "",
      commands: [],
    });
  });

  it("ranks title-prefix matches above keyword-only matches", () => {
    const commands = [
      { id: "highlight", title: "Highlight" },
      { id: "heading", title: "Heading", keywords: ["h1"] },
    ];
    // Title prefix tier; "Heading" (7 chars) wins over "Highlight" (9 chars).
    expect(filterSlashCommands(commands, "h").map((c) => c.id)).toEqual([
      "heading",
      "highlight",
    ]);
  });

  it("propagates limit through getSlashState", () => {
    const commands = Array.from({ length: 10 }, (_, i) => ({
      id: `cmd-${i}`,
      title: `Command ${i}`,
    }));
    const state = getSlashState("/com", 4, commands, { limit: 2 });
    expect(state.commands).toHaveLength(2);
  });

  it("preserves an optional run callback through filterSlashCommands", () => {
    const run = () => true;
    const filtered = filterSlashCommands(
      [{ id: "h1", title: "Heading 1", run }],
      "head",
    );
    expect(filtered[0].run).toBe(run);
  });

  it("provides default /todo and /task commands that format task items", () => {
    const todoCmd = defaultSlashCommands.find((c) => c.id === "todo");
    const taskCmd = defaultSlashCommands.find((c) => c.id === "task");
    expect(todoCmd).toBeDefined();
    expect(taskCmd).toBeDefined();
    expect(todoCmd?.title).toBe("To-do list");

    const mockEditor = {
      doc: "/todo",
      selection: { anchor: 5, head: 5 },
      getDocument() {
        return this.doc;
      },
      getSelection() {
        return this.selection;
      },
      replaceRange(
        from: number,
        to: number,
        insert: string,
        sel?: { anchor: number },
      ) {
        this.doc = this.doc.slice(0, from) + insert + this.doc.slice(to);
        if (sel) this.selection = { anchor: sel.anchor, head: sel.anchor };
      },
    };

    const res = todoCmd?.run?.(mockEditor as any);
    expect(res).toBe(true);
    expect(mockEditor.getDocument()).toBe("- [ ] ");
  });
});
