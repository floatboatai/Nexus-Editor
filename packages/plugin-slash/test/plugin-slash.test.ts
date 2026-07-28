import { describe, expect, it } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  createSlashPlugin,
  filterSlashCommands,
  getSlashState,
  getSlashMatch
} from "../src/index";
import { createSlashMenuUI } from "../src/menu-ui";

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
});

describe("@floatboat/nexus-plugin-slash transact undo", () => {
  it("one Ctrl+Z after slash confirm restores /query and command effect", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const slashCommands: SlashCommandDef[] = [
      {
        id: "bold",
        title: "Bold",
        // Inside transact, view.state is frozen. getDocument() and
        // replaceSelection use the original (pre-transact) state.
        // Commands should use replaceRange with explicit positions
        // instead of getDocument()/replaceSelection.
        run: (editor) => {
          editor.replaceRange(0, 0, "**bold**");
        },
      },
    ];

    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [
        createHistoryPlugin(),
        { name: "test-slash", slashCommands },
      ],
    });

    const menu = createSlashMenuUI(editor);

    // Mimic user typing "/bold": setDocument fires updateListener →
    // computeSlashState → getSlashMatch("/bold", 5) → slashMenuChange
    // → menu opens. Then press Enter to confirm.
    editor.setDocument("/bold");
    editor.setSelection(5);

    // Small delay to let the menu state settle after setSelection
    // dispatches the second updateListener callback.
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(enterEvent);

    // After confirm: trigger deleted, bold applied
    expect(editor.getDocument()).toBe("**bold**");

    // One undo reverts both trigger deletion AND command
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("/bold");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");

    menu.destroy();
    editor.destroy();
    container.remove();
  });
});
