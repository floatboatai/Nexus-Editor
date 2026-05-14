import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleUnorderedList,
  toggleOrderedList,
  toggleBlockquote,
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

// ── Multi-line toggle tests ───────────────────────────────────────────────────

describe("toggleUnorderedList — multi-line", () => {
  it("adds - marker to all lines when none have it", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar\nbaz" });
    editor.setSelection(0, 11);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar\n- baz");
    editor.destroy();
  });

  it("adds - marker to all lines when only some have it (mixed state)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\n- bar\nbaz" });
    editor.setSelection(0, 13);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar\n- baz");
    editor.destroy();
  });

  it("removes - marker from all lines when all have it", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- foo\n- bar\n- baz" });
    editor.setSelection(0, 17);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("foo\nbar\nbaz");
    editor.destroy();
  });

  it("converts ordered list markers to unordered on multi-line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. foo\n2. bar" });
    editor.setSelection(0, 13);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- foo\n- bar");
    editor.destroy();
  });

  it("single-line behavior is unchanged (backward compat)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });
    editor.setSelection(2);
    toggleUnorderedList(editor);
    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });
});

describe("toggleOrderedList — multi-line", () => {
  it("adds incrementing numbered markers to all lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar\nbaz" });
    editor.setSelection(0, 11);
    toggleOrderedList(editor);
    expect(editor.getDocument()).toBe("1. foo\n2. bar\n3. baz");
    editor.destroy();
  });

  it("removes numbered markers when all lines have them", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. foo\n2. bar\n3. baz" });
    editor.setSelection(0, 20);
    toggleOrderedList(editor);
    expect(editor.getDocument()).toBe("foo\nbar\nbaz");
    editor.destroy();
  });

  it("adds ordered markers when only some lines have them (mixed state)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\n2. bar\nbaz" });
    editor.setSelection(0, 14);
    toggleOrderedList(editor);
    expect(editor.getDocument()).toBe("1. foo\n2. bar\n3. baz");
    editor.destroy();
  });

  it("single-line behavior is unchanged (backward compat)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });
    editor.setSelection(2);
    toggleOrderedList(editor);
    expect(editor.getDocument()).toBe("1. hello");
    editor.destroy();
  });
});

describe("toggleBlockquote — multi-line", () => {
  it("adds > prefix to all lines when none have it", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo\nbar" });
    editor.setSelection(0, 7);
    toggleBlockquote(editor);
    expect(editor.getDocument()).toBe("> foo\n> bar");
    editor.destroy();
  });

  it("removes > prefix from all lines when all have it", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "> foo\n> bar" });
    editor.setSelection(0, 11);
    toggleBlockquote(editor);
    expect(editor.getDocument()).toBe("foo\nbar");
    editor.destroy();
  });

  it("single-line behavior is unchanged (backward compat)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });
    editor.setSelection(2);
    toggleBlockquote(editor);
    expect(editor.getDocument()).toBe("> hello");
    editor.destroy();
  });
});
