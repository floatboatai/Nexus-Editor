import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
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

// ── Multi-line toggles ──────────────────────────────────────────

describe("toggleBlockquote", () => {
  it("adds > prefix to a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(2, 2);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> hello world");
    editor.destroy();
  });

  it("removes > prefix from a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "> hello world",
    });

    editor.setSelection(4, 4);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("hello world");
    editor.destroy();
  });

  it("adds > prefix to multiple selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "line one\nline two\nline three",
    });

    editor.setSelection(0, 20);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> line one\n> line two\n> line three");
    editor.destroy();
  });

  it("removes > prefix from multiple quoted lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "> line one\n> line two\n> line three",
    });

    editor.setSelection(0, 30);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("line one\nline two\nline three");
    editor.destroy();
  });

  it("removes > (no trailing space) as well", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: ">line one\n>line two",
    });

    editor.setSelection(0, 18);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("line one\nline two");
    editor.destroy();
  });

  it("adds quotes when some lines already have them (mixed state)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "> line one\nplain line",
    });

    editor.setSelection(0, 21);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> line one\n> plain line");
    editor.destroy();
  });

  it("skips empty lines in a multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "line one\n\nline two",
    });

    editor.setSelection(0, 18);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> line one\n\n> line two");
    editor.destroy();
  });
});

describe("toggleOrderedList", () => {
  it("adds ordered list marker to a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(4, 4);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. hello world");
    editor.destroy();
  });

  it("removes ordered list marker from a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. hello world",
    });

    editor.setSelection(6, 6);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("hello world");
    editor.destroy();
  });

  it("adds sequential numbers to multiple selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "first\nsecond\nthird",
    });

    editor.setSelection(0, 18);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. first\n2. second\n3. third");
    editor.destroy();
  });

  it("removes ordered markers from multiple numbered lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. first\n2. second\n3. third",
    });

    editor.setSelection(0, 24);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("first\nsecond\nthird");
    editor.destroy();
  });

  it("removes ordered markers when all selected lines have them", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "99. old\n5. numbers",
    });

    editor.setSelection(0, 18);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("old\nnumbers");
    editor.destroy();
  });

  it("converts unordered markers to ordered", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- bullet\n* star\n+ plus",
    });

    editor.setSelection(0, 20);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. bullet\n2. star\n3. plus");
    editor.destroy();
  });

  it("skips empty lines while maintaining sequential numbering", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "first\n\nthird",
    });

    editor.setSelection(0, 12);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. first\n\n2. third");
    editor.destroy();
  });
});

describe("toggleUnorderedList", () => {
  it("adds unordered marker to a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(4, 4);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello world");
    editor.destroy();
  });

  it("removes unordered marker from a single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- hello world",
    });

    editor.setSelection(6, 6);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("hello world");
    editor.destroy();
  });

  it("adds bullet markers to multiple selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "first\nsecond\nthird",
    });

    editor.setSelection(0, 18);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- first\n- second\n- third");
    editor.destroy();
  });

  it("removes bullet markers from multiple lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- first\n- second\n- third",
    });

    editor.setSelection(0, 24);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("first\nsecond\nthird");
    editor.destroy();
  });

  it("handles mixed unordered markers (*, -, +) in a selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- dash\n* star\n+ plus",
    });

    editor.setSelection(0, 20);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("dash\nstar\nplus");
    editor.destroy();
  });

  it("adds bullets when only some lines have markers (mixed state)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- first\nplain\n- third",
    });

    editor.setSelection(0, 21);
    toggleUnorderedList(editor);

    // plain line gets a bullet; existing ones are re-marked with "- "
    expect(editor.getDocument()).toBe("- first\n- plain\n- third");
    editor.destroy();
  });

  it("converts ordered markers to unordered", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. first\n2. second\n3. third",
    });

    editor.setSelection(0, 24);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- first\n- second\n- third");
    editor.destroy();
  });

  it("toggles task list items off", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- [ ] todo\n- [x] done",
    });

    editor.setSelection(0, 20);
    toggleUnorderedList(editor);

    // Checkbox content stays as plain text; only the list marker is removed
    expect(editor.getDocument()).toBe("[ ] todo\n[x] done");
    editor.destroy();
  });

  it("toggles task list items back on", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "[ ] todo\n[x] done",
    });

    editor.setSelection(0, 17);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- [ ] todo\n- [x] done");
    editor.destroy();
  });

  it("preserves indentation on nested items when adding", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "parent\n  child",
    });

    editor.setSelection(0, 14);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- parent\n  - child");
    editor.destroy();
  });

  it("preserves indentation on nested items when removing", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- parent\n  - child",
    });

    editor.setSelection(0, 18);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("parent\n  child");
    editor.destroy();
  });

  it("skips empty lines in a multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "first\n\nsecond",
    });

    editor.setSelection(0, 13);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- first\n\n- second");
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
