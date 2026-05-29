import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  createToolbarPlugin,
  createToolbarUI,
  toggleOrderedList,
  toggleUnorderedList,
  toggleBlockquote,
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

// ------------------------------------------------------------------
// Multi-line list toggle (ROADMAP #1)
// ------------------------------------------------------------------

describe("toggleOrderedList – multi-line", () => {
  it("adds ordered list markers to multiple plain lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "apple\nbanana\ncherry" });

    editor.setSelection(0, 18);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. apple\n2. banana\n3. cherry");
    editor.destroy();
  });

  it("removes ordered list markers when all lines are already OL", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. apple\n2. banana\n3. cherry" });

    editor.setSelection(0, 27);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("apple\nbanana\ncherry");
    editor.destroy();
  });

  it("converts unordered list lines to ordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- apple\n- banana\n- cherry" });

    editor.setSelection(0, 24);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. apple\n2. banana\n3. cherry");
    editor.destroy();
  });

  it("falls back to single-line behaviour when cursor only", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "apple\nbanana\ncherry" });

    editor.setSelection(9);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("apple\n1. banana\ncherry");
    editor.destroy();
  });

  it("handles mixed OL/plain/UL lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. apple\n- banana\ncherry" });

    editor.setSelection(0, 23);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. apple\n2. banana\n3. cherry");
    editor.destroy();
  });

  it("preserves text content after list markers", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- hello world\n- foo bar" });

    editor.setSelection(0, 23);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. hello world\n2. foo bar");
    editor.destroy();
  });

  it("handles selection that starts mid-line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "aaa\nbbb\nccc" });

    // Select from middle of first line to middle of last line
    editor.setSelection(2, 9);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. aaa\n2. bbb\n3. ccc");
    editor.destroy();
  });
});

describe("toggleUnorderedList – multi-line", () => {
  it("adds unordered list markers to multiple plain lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "apple\nbanana\ncherry" });

    editor.setSelection(0, 18);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- apple\n- banana\n- cherry");
    editor.destroy();
  });

  it("removes unordered list markers when all lines are already UL", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- apple\n- banana\n- cherry" });

    editor.setSelection(0, 24);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("apple\nbanana\ncherry");
    editor.destroy();
  });

  it("converts ordered list lines to unordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. apple\n2. banana\n3. cherry" });

    editor.setSelection(0, 27);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- apple\n- banana\n- cherry");
    editor.destroy();
  });

  it("handles mixed UL/plain/OL lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- apple\n1. banana\ncherry" });

    editor.setSelection(0, 24);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- apple\n- banana\n- cherry");
    editor.destroy();
  });

  it("falls back to single-line behaviour when cursor only", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "apple\nbanana\ncherry" });

    editor.setSelection(9);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("apple\n- banana\ncherry");
    editor.destroy();
  });
});

// ------------------------------------------------------------------
// Multi-line blockquote toggle
// ------------------------------------------------------------------

describe("toggleBlockquote – multi-line", () => {
  it("adds blockquote prefix to multiple plain lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello\nworld" });

    editor.setSelection(0, 11);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> hello\n> world");
    editor.destroy();
  });

  it("removes blockquote prefix when all lines are already quoted", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "> hello\n> world" });

    editor.setSelection(0, 15);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("hello\nworld");
    editor.destroy();
  });

  it("falls back to single-line when cursor only", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello\nworld" });

    editor.setSelection(3);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> hello\nworld");
    editor.destroy();
  });
});
