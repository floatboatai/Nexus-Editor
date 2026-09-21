import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleOrderedList,
  toggleUnorderedList,
  insertTable,
  toggleTaskList,
  toggleTaskChecked,
  createToolbarPlugin,
  createToolbarUI,
} from "../src/index";

describe("toggleBold", () => {
  it("wraps selected text with **", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });

  it("removes ** when already wrapped", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello **world**" });

    editor.setSelection(8, 13);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hello world");
    editor.destroy();
  });
});

describe("toggleItalic", () => {
  it("wraps selected text with *", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("hello *world*");
    editor.destroy();
  });
});

describe("toggleInlineCode", () => {
  it("wraps selected text with backticks", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    toggleInlineCode(editor);

    expect(editor.getDocument()).toBe("hello `world`");
    editor.destroy();
  });
});

describe("insertLink", () => {
  it("inserts a link template with selected text", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "click here" });

    editor.setSelection(6, 10);
    insertLink(editor);

    expect(editor.getDocument()).toBe("click [here](url)");
    editor.destroy();
  });

  it("inserts default link text when nothing is selected", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "text " });

    editor.setSelection(5, 5);
    insertLink(editor);

    expect(editor.getDocument()).toBe("text [link text](url)");
    editor.destroy();
  });
});

describe("toggleHeading", () => {
  it("adds heading prefix to current line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Title" });

    editor.setSelection(2);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("## Title");
    editor.destroy();
  });

  it("removes heading when same level is toggled", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "## Title" });

    editor.setSelection(5);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("Title");
    editor.destroy();
  });

  it("switches heading level", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "## Title" });

    editor.setSelection(5);
    toggleHeading(editor, 1);

    expect(editor.getDocument()).toBe("# Title");
    editor.destroy();
  });
});

describe("toggleUnorderedList — single line (existing behaviour)", () => {
  it("adds bullet marker to current line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(2);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });

  it("removes bullet marker when already present", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- hello" });

    editor.setSelection(4);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("replaces ordered-list marker with bullet", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. hello" });

    editor.setSelection(4);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });
});

describe("toggleUnorderedList — multi-line selection", () => {
  it("adds bullet markers to every selected line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar\nbaz" });

    editor.setSelection(0, 11);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\n- bar\n- baz");
    editor.destroy();
  });

  it("removes bullet markers when all selected lines already have one", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- foo\n- bar\n- baz" });

    editor.setSelection(0, 17);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("foo\nbar\nbaz");
    editor.destroy();
  });

  it("adds bullets when only some lines have markers (mixed → toggle on)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- foo\nbar" });

    editor.setSelection(0, 9);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });

  it("normalizes reversed selection (head before anchor)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });

    editor.setSelection(7, 0); // reversed
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });

  it("does not include the next line when selection ends at its start", () => {
    const container = document.createElement("div");
    // selection covers "foo\n" (positions 0-4); "bar" starts at 4
    const editor = createEditor({ container, initialValue: "foo\nbar" });

    editor.setSelection(0, 4);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\nbar");
    editor.destroy();
  });

  it("replaces ordered-list markers with bullets across lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. foo\n2. bar" });

    editor.setSelection(0, 13);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });
});

describe("toggleOrderedList — single line (existing behaviour)", () => {
  it("adds numbered marker to current line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(2);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. hello");
    editor.destroy();
  });

  it("removes numbered marker when already present", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. hello" });

    editor.setSelection(4);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });
});

describe("toggleOrderedList — multi-line selection", () => {
  it("adds sequential numbers to every selected line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar\nbaz" });

    editor.setSelection(0, 11);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. foo\n2. bar\n3. baz");
    editor.destroy();
  });

  it("removes numbered markers when all selected lines already have one", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. foo\n2. bar\n3. baz" });

    editor.setSelection(0, 20); // doc length = 20
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("foo\nbar\nbaz");
    editor.destroy();
  });

  it("adds numbers when only some lines have markers (mixed → toggle on)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. foo\nbar" });

    editor.setSelection(0, 10);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. foo\n2. bar");
    editor.destroy();
  });

  it("replaces bullet markers with sequential numbers", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- foo\n- bar" });

    editor.setSelection(0, 11);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. foo\n2. bar");
    editor.destroy();
  });

  it("normalizes reversed selection (head before anchor)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });

    editor.setSelection(7, 0); // reversed
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. foo\n2. bar");
    editor.destroy();
  });
});

// ── Destructive / round-trip tests ──────────────────────────────────────────

describe("list toggle — round-trip stability", () => {
  it("UL: toggle on then off restores original document", () => {
    const container = document.createElement("div");
    const original = "foo\nbar\nbaz";
    const editor = createEditor({ container, initialValue: original });

    editor.setSelection(0, 11);
    toggleUnorderedList(editor); // on
    const { anchor, head } = editor.getSelection();
    editor.setSelection(anchor, head);
    toggleUnorderedList(editor); // off

    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });

  it("OL: toggle on then off restores original document", () => {
    const container = document.createElement("div");
    const original = "foo\nbar\nbaz";
    const editor = createEditor({ container, initialValue: original });

    editor.setSelection(0, 11);
    toggleOrderedList(editor); // on → "1. foo\n2. bar\n3. baz"
    const { anchor, head } = editor.getSelection();
    editor.setSelection(anchor, head);
    toggleOrderedList(editor); // off

    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });

  it("UL→OL→UL produces consistent output at each step", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });

    editor.setSelection(0, 7);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar");

    const s1 = editor.getSelection();
    editor.setSelection(s1.anchor, s1.head);
    toggleOrderedList(editor);
    expect(editor.getDocument()).toBe("1. foo\n2. bar");

    const s2 = editor.getSelection();
    editor.setSelection(s2.anchor, s2.head);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar");

    editor.destroy();
  });
});

describe("list toggle — selection at document boundary", () => {
  it("handles selection that reaches the last character of the document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });
    const len = "foo\nbar".length; // 7

    editor.setSelection(0, len);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });

  it("single line at end of document toggles correctly", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });

    editor.setSelection(4); // cursor on "bar"
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("foo\n1. bar");
    editor.destroy();
  });
});

describe("getSelectedText and range-aware toggles — API collaboration", () => {
  it("getSelectedText reflects the full multi-line selection before toggle", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar\nbaz" });

    editor.setSelection(0, 11);
    expect(editor.getSelectedText()).toBe("foo\nbar\nbaz");

    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar\n- baz");
    editor.destroy();
  });

  it("getSelectedText on collapsed cursor returns empty string even after toggle", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(2);
    expect(editor.getSelectedText()).toBe("");

    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- hello");
    expect(editor.getSelectedText()).toBe(""); // cursor, not selection
    editor.destroy();
  });
});

describe("createToolbarPlugin", () => {
  it("returns a plugin with keyboard shortcuts", () => {
    const plugin = createToolbarPlugin();

    expect(plugin.name).toBe("plugin-toolbar");
    expect(plugin.shortcuts).toBeDefined();
    expect(plugin.shortcuts!.length).toBeGreaterThanOrEqual(6);
  });

  it("integrates with the editor shortcut system", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [createToolbarPlugin()],
    });

    editor.setSelection(6, 11);
    editor.runShortcut("Mod-b");

    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });

  it("registers every formatting action as a slash command", () => {
    const plugin = createToolbarPlugin();
    const ids = (plugin.slashCommands ?? []).map((c) => c.id);
    // Spot-check the four user-facing categories; the full catalogue is
    // documented in src/index.ts and intentionally not pinned here so
    // adding more commands later isn't a test churn.
    expect(ids).toEqual(expect.arrayContaining(["h1", "h2", "bold", "image", "hr"]));
    for (const cmd of plugin.slashCommands ?? []) {
      expect(typeof cmd.run).toBe("function");
    }
  });

  it("executes a slash command through the editor's command list", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [createToolbarPlugin()],
    });

    editor.setSelection(6, 11);
    const bold = editor.getSlashCommands().find((c) => c.id === "bold");
    expect(bold).toBeDefined();
    expect(bold?.run?.(editor)).toBe(true);
    expect(editor.getDocument()).toBe("hello **world**");
    editor.destroy();
  });
});

describe("createToolbarUI", () => {
  it("shows custom text tooltip for icon-only toolbar buttons", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);

    const button = toolbar.element.querySelector<HTMLButtonElement>('[data-toolbar-action="unordered-list"]');
    expect(button).not.toBeNull();
    expect(button?.title).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Unordered list");
    expect(button?.dataset.toolbarTooltip).toBe("Unordered list");
    expect(button?.getAttribute("aria-describedby")).toMatch(/^nexus-toolbar-tooltip-/);

    button?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.textContent).toBe("Unordered list");

    button?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(document.getElementById(button?.getAttribute("aria-describedby") ?? "")).toBeNull();

    toolbar.destroy();
    editor.destroy();
  });
});

describe("toggleUnorderedList — atomic undo", () => {
  // All tests register createHistoryPlugin() so CM6 history is active.
  // Case 4 is the load-bearing regression guard: it fails on the old
  // two-dispatch code (setDocument + setSelection) and passes only after
  // applyLines is refactored to use replaceRange in one transaction.

  it("Case 1: multi-line toggle → single undo fully restores document", () => {
    const container = document.createElement("div");
    const original = "foo\nbar\nbaz";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 11);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar\n- baz");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });

  it("Case 2: toggle → undo → redo recovers toggled state in one step", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar", plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 7);
    toggleUnorderedList(editor);
    editor.undo();
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });

  it("Case 3: single-line toggle → undo restores original (regression guard)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello", plugins: [createHistoryPlugin()] });

    editor.setSelection(2);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- hello");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("Case 4 (load-bearing): multi-line toggle → undo → second undo returns false", () => {
    // Proves exactly one history entry was created. On the old two-dispatch
    // code this test fails because the second undo() returns true (and
    // leaves the document half-reverted). After the atomic replaceRange
    // refactor, undo() exhausts history after one call.
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar", plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 7);
    toggleUnorderedList(editor);
    editor.undo();

    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("Case 5: reversed multi-line selection → toggle → undo restores original", () => {
    const container = document.createElement("div");
    const original = "foo\nbar";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(7, 0); // reversed: head before anchor
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });

  it("Case 6: collapsed cursor → toggle → undo restores original", () => {
    const container = document.createElement("div");
    const original = "foo\nbar\nbaz";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(5); // cursor inside "bar" line
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("foo\n- bar\nbaz");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });

  it("Case 7: toggle → undo → redo → undo round-trip is consistent", () => {
    const container = document.createElement("div");
    const original = "foo\nbar";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 7);
    toggleUnorderedList(editor);
    const toggled = "- foo\n- bar";
    expect(editor.getDocument()).toBe(toggled);

    editor.undo();
    expect(editor.getDocument()).toBe(original);

    editor.redo();
    expect(editor.getDocument()).toBe(toggled);

    editor.undo();
    expect(editor.getDocument()).toBe(original);
    editor.destroy();
  });
});

describe("insertTable", () => {
  it("inserts a default 3x3 table with header at the document start", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    editor.setSelection(0, 0);
    insertTable(editor);

    const expected = [
      "| Header 1 | Header 2 | Header 3 |",
      "| --- | --- | --- |",
      "|  |  |  |",
      "|  |  |  |",
      "|  |  |  |",
    ].join("\n");
    expect(editor.getDocument()).toBe(expected);
    editor.destroy();
  });

  it("places the caret inside the first body cell", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    editor.setSelection(0, 0);
    insertTable(editor);

    const { anchor } = editor.getSelection();
    // The caret should sit between the two spaces of the first empty cell.
    expect(editor.getDocument()[anchor - 1]).toBe(" ");
    expect(editor.getDocument()[anchor]).toBe(" ");
    expect(editor.getDocument()[anchor + 1]).toBe("|");
    editor.destroy();
  });

  it("honours cols / rows / includeHeaderRow options", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    editor.setSelection(0, 0);
    insertTable(editor, { cols: 2, rows: 1, includeHeaderRow: false });

    const expected = ["| --- | --- |", "|  |  |"].join("\n");
    expect(editor.getDocument()).toBe(expected);
    editor.destroy();
  });

  it("emits a header row when includeHeaderRow is true and rows is 1", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    editor.setSelection(0, 0);
    insertTable(editor, { cols: 1, rows: 1, includeHeaderRow: true });

    const expected = ["| Header 1 |", "| --- |", "|  |"].join("\n");
    expect(editor.getDocument()).toBe(expected);
    editor.destroy();
  });

  it("adds surrounding newlines when inserted into the middle of a line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "word" });

    editor.setSelection(4, 4); // end of "word"
    insertTable(editor);

    const doc = editor.getDocument();
    const table = [
      "| Header 1 | Header 2 | Header 3 |",
      "| --- | --- | --- |",
      "|  |  |  |",
      "|  |  |  |",
      "|  |  |  |",
    ].join("\n");
    expect(doc.startsWith("word\n")).toBe(true);
    expect(doc.endsWith(table)).toBe(true);
    editor.destroy();
  });

  it("does not add a leading newline at the very start of the document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "word" });

    editor.setSelection(0, 0);
    insertTable(editor);

    const doc = editor.getDocument();
    const table = [
      "| Header 1 | Header 2 | Header 3 |",
      "| --- | --- | --- |",
      "|  |  |  |",
      "|  |  |  |",
      "|  |  |  |",
    ].join("\n");
    // From=0 → no leading newline; the table is immediately followed by "word".
    expect(doc.startsWith(table)).toBe(true);
    expect(doc.endsWith("word")).toBe(true);
    editor.destroy();
  });
});

describe("toggleTaskList", () => {
  it("converts a plain text line into a task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "buy milk" });

    editor.setSelection(0, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] buy milk");
    editor.destroy();
  });

  it("converts an unordered list item into a task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- buy milk" });

    editor.setSelection(0, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] buy milk");
    editor.destroy();
  });

  it("converts an ordered list item into a task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. buy milk" });

    editor.setSelection(0, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] buy milk");
    editor.destroy();
  });

  it("preserves leading indentation when converting", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "  plain" });

    editor.setSelection(2, 2);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("  - [ ] plain");
    editor.destroy();
  });

  it("removes the marker when toggling an existing task item off", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] buy milk" });

    editor.setSelection(0, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("buy milk");
    editor.destroy();
  });

  it("removes the marker from a checked task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [x] buy milk" });

    editor.setSelection(0, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("buy milk");
    editor.destroy();
  });

  it("toggles every selected line into task items (multi-line)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb\nc" });

    editor.setSelection(0, 4); // covers "a\nb", leaves "c" untouched
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b\nc");
    editor.destroy();
  });

  it("toggles a multi-line task list off in one pass", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a\n- [ ] b" });

    editor.setSelection(0, 13);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("a\nb");
    editor.destroy();
  });

  it("normalises a mixed selection to task items without removing existing ones", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a\nb" });

    editor.setSelection(0, 9);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b");
    editor.destroy();
  });

  it("normalises checked items back to unchecked within a mixed toggle", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [x] a\nb" });

    editor.setSelection(0, 9);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b");
    editor.destroy();
  });

  it("handles a reversed (head before anchor) selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb" });

    editor.setSelection(3, 0);
    toggleTaskList(editor);

    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b");
    editor.destroy();
  });
});

describe("insertTable — atomic undo", () => {
  it("insert → single undo fully restores the document", () => {
    const container = document.createElement("div");
    const original = "hello world";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 0);
    insertTable(editor);
    expect(editor.getDocument()).not.toBe(original);

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);

    // Exactly one history entry was created.
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("insert → undo → redo round-trip is consistent", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "text", plugins: [createHistoryPlugin()] });

    editor.setSelection(4, 4);
    insertTable(editor);
    const inserted = editor.getDocument();
    expect(inserted.startsWith("text\n")).toBe(true);

    editor.undo();
    expect(editor.getDocument()).toBe("text");

    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe(inserted);
    editor.destroy();
  });
});

describe("toggleTaskList — atomic undo", () => {
  it("multi-line toggle → single undo restores the document", () => {
    const container = document.createElement("div");
    const original = "a\nb\nc";
    const editor = createEditor({ container, initialValue: original, plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 4); // covers "a\nb", leaves "c" untouched
    toggleTaskList(editor);
    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b\nc");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);

    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("toggle off → undo restores the task list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a\n- [ ] b", plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 13);
    toggleTaskList(editor);
    expect(editor.getDocument()).toBe("a\nb");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("- [ ] a\n- [ ] b");
    editor.destroy();
  });
});

describe("toolbar slash commands — table and task list", () => {
  it("registers table and task-list as slash commands", () => {
    const plugin = createToolbarPlugin();
    const ids = (plugin.slashCommands ?? []).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["table", "task-list"]));
  });

  it("executes the table slash command through the editor", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "", plugins: [createToolbarPlugin()] });

    editor.setSelection(0, 0);
    const tableCmd = editor.getSlashCommands().find((c) => c.id === "table");
    expect(tableCmd).toBeDefined();
    expect(tableCmd?.run?.(editor)).toBe(true);
    expect(editor.getDocument().startsWith("| Header 1 |")).toBe(true);
    editor.destroy();
  });

  it("executes the task-list slash command through the editor", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "todo", plugins: [createToolbarPlugin()] });

    editor.setSelection(0, 0);
    const cmd = editor.getSlashCommands().find((c) => c.id === "task-list");
    expect(cmd).toBeDefined();
    expect(cmd?.run?.(editor)).toBe(true);
    expect(editor.getDocument()).toBe("- [ ] todo");
    editor.destroy();
  });
});

describe("toolbar UI — table and task-list buttons", () => {
  it("renders a table button that inserts a table on click", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);

    const button = toolbar.element.querySelector<HTMLButtonElement>('[data-toolbar-action="table"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Insert table");

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getDocument().startsWith("| Header 1 |")).toBe(true);

    toolbar.destroy();
    editor.destroy();
  });

  it("renders a task-list button that toggles a task item on click", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "todo" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);

    editor.setSelection(0, 0);
    const button = toolbar.element.querySelector<HTMLButtonElement>('[data-toolbar-action="task-list"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Task list");

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getDocument()).toBe("- [ ] todo");

    toolbar.destroy();
    editor.destroy();
  });
});

describe("insertTable — replaces a non-empty selection", () => {
  it("replaces the selected text with the table", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "remove this text" });

    editor.setSelection(0, "remove this text".length);
    insertTable(editor);

    const doc = editor.getDocument();
    expect(doc).not.toContain("remove this text");
    expect(doc.startsWith("| Header 1 |")).toBe(true);
    editor.destroy();
  });

  it("keeps surrounding content intact when replacing a mid-document selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "before\nmiddle\nafter" });

    // Select the word "middle".
    editor.setSelection("before\n".length, "before\nmiddle".length);
    insertTable(editor);

    const doc = editor.getDocument();
    expect(doc.startsWith("before\n")).toBe(true);
    expect(doc.endsWith("\nafter")).toBe(true);
    expect(doc).not.toContain("middle");
    expect(doc).toContain("| Header 1 |");
    editor.destroy();
  });
});

describe("toggleTaskChecked", () => {
  it("checks an unchecked task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a" });

    editor.setSelection(0, 0);
    expect(toggleTaskChecked(editor)).toBe(true);
    expect(editor.getDocument()).toBe("- [x] a");
    editor.destroy();
  });

  it("unchecks a checked task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [x] a" });

    editor.setSelection(0, 0);
    expect(toggleTaskChecked(editor)).toBe(true);
    expect(editor.getDocument()).toBe("- [ ] a");
    editor.destroy();
  });

  it("flips only the task items in a mixed selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a\n- [x] b\nplain" });

    editor.setSelection(0, 15);
    expect(toggleTaskChecked(editor)).toBe(true);
    expect(editor.getDocument()).toBe("- [x] a\n- [ ] b\nplain");
    editor.destroy();
  });

  it("is a no-op and returns false when there is no task item", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "plain text" });

    editor.setSelection(0, 0);
    expect(toggleTaskChecked(editor)).toBe(false);
    expect(editor.getDocument()).toBe("plain text");
    editor.destroy();
  });

  it("flips checked state as a single undo step", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] a", plugins: [createHistoryPlugin()] });

    editor.setSelection(0, 0);
    toggleTaskChecked(editor);
    expect(editor.getDocument()).toBe("- [x] a");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("- [ ] a");

    // Exactly one history entry.
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });
});

describe("toolbar slash commands — task-toggle", () => {
  it("registers task-toggle as a slash command", () => {
    const plugin = createToolbarPlugin();
    const ids = (plugin.slashCommands ?? []).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["task-toggle"]));
  });

  it("executes the task-toggle slash command through the editor", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] todo", plugins: [createToolbarPlugin()] });

    editor.setSelection(0, 0);
    const cmd = editor.getSlashCommands().find((c) => c.id === "task-toggle");
    expect(cmd).toBeDefined();
    expect(cmd?.run?.(editor)).toBe(true);
    expect(editor.getDocument()).toBe("- [x] todo");
    editor.destroy();
  });
});

describe("toolbar UI — task-toggle button", () => {
  it("renders a task-toggle button that flips the checkbox on click", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- [ ] todo" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);

    editor.setSelection(0, 0);
    const button = toolbar.element.querySelector<HTMLButtonElement>('[data-toolbar-action="task-toggle"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Toggle checkboxes");

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getDocument()).toBe("- [x] todo");

    toolbar.destroy();
    editor.destroy();
  });
});