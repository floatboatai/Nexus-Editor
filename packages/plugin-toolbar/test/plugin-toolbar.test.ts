import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  insertLink,
  toggleHeading,
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

// ── Multi-line List Toggle ──

describe("toggleOrderedList", () => {
  it("converts single line to ordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Line 1\nLine 2\nLine 3" });

    editor.setSelection(0, 6); // Select "Line 1"
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. Line 1\nLine 2\nLine 3");
    editor.destroy();
  });

  it("converts multiple lines to ordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Line 1\nLine 2\nLine 3" });

    // Select lines 1 and 2
    editor.setSelection(0, 13);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. Line 1\n2. Line 2\nLine 3");
    editor.destroy();
  });

  it("converts all lines to ordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Line 1\nLine 2\nLine 3" });

    // Select all lines
    editor.setSelection(0, 20);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. Line 1\n2. Line 2\n3. Line 3");
    editor.destroy();
  });

  it("removes ordered list markers when all lines are ordered lists", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. Line 1\n2. Line 2\n3. Line 3" });

    // Select all lines
    editor.setSelection(0, 26);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("Line 1\nLine 2\nLine 3");
    editor.destroy();
  });

  it("converts unordered list to ordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- Line 1\n- Line 2" });

    editor.setSelection(0, 16);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. Line 1\n2. Line 2");
    editor.destroy();
  });
});

describe("toggleUnorderedList", () => {
  it("converts single line to unordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Line 1\nLine 2\nLine 3" });

    editor.setSelection(0, 6);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- Line 1\nLine 2\nLine 3");
    editor.destroy();
  });

  it("converts multiple lines to unordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Line 1\nLine 2\nLine 3" });

    editor.setSelection(0, 13);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- Line 1\n- Line 2\nLine 3");
    editor.destroy();
  });

  it("removes unordered list markers when all lines are unordered lists", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- Line 1\n- Line 2\n- Line 3" });

    editor.setSelection(0, 23);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("Line 1\nLine 2\nLine 3");
    editor.destroy();
  });

  it("converts ordered list to unordered list", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. Line 1\n2. Line 2" });

    editor.setSelection(0, 18);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- Line 1\n- Line 2");
    editor.destroy();
  });

  it("handles mixed list types in selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. Line 1\n- Line 2\nLine 3" });

    editor.setSelection(0, 24);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- Line 1\n- Line 2\n- Line 3");
    editor.destroy();
  });
});
