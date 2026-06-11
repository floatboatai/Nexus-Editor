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

// ─── Multi-line toggles ────────────────────────────────────────────────────

describe("toggleUnorderedList — multi-line", () => {
  it("applies `- ` to every selected line when none are lists", () => {
    const container = document.createElement("div");
    const doc = "alpha\nbeta\ngamma";
    const editor = createEditor({ container, initialValue: doc });

    // Select from start of "alpha" to end of "gamma"
    editor.setSelection(0, doc.length);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- alpha\n- beta\n- gamma");
    editor.destroy();
  });

  it("removes `- ` from every line when all are unordered lists", () => {
    const container = document.createElement("div");
    const doc = "- alpha\n- beta\n- gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("applies `- ` to all lines when selection is mixed (some listed, some not)", () => {
    const container = document.createElement("div");
    const doc = "- alpha\nbeta\n- gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- alpha\n- beta\n- gamma");
    editor.destroy();
  });

  it("converts ordered-list lines to unordered when toggling ul", () => {
    const container = document.createElement("div");
    const doc = "1. alpha\n2. beta";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- alpha\n- beta");
    editor.destroy();
  });

  it("falls back to single-line behaviour when anchor === head", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(2);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });

  it("preserves leading indentation when toggling nested list lines", () => {
    const container = document.createElement("div");
    const doc = "  - nested\n  - item";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("  nested\n  item");
    editor.destroy();
  });
});

describe("toggleOrderedList — multi-line", () => {
  it("applies sequential numbers to every selected line", () => {
    const container = document.createElement("div");
    const doc = "alpha\nbeta\ngamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. alpha\n2. beta\n3. gamma");
    editor.destroy();
  });

  it("removes ordered markers from every line when all are ordered lists", () => {
    const container = document.createElement("div");
    const doc = "1. alpha\n2. beta\n3. gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("applies ordered markers when selection is mixed (some ordered, some not)", () => {
    const container = document.createElement("div");
    const doc = "1. alpha\nbeta\n3. gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. alpha\n2. beta\n3. gamma");
    editor.destroy();
  });

  it("converts unordered-list lines to ordered, re-numbering from 1", () => {
    const container = document.createElement("div");
    const doc = "- alpha\n- beta\n- gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. alpha\n2. beta\n3. gamma");
    editor.destroy();
  });
});

describe("toggleBlockquote — multi-line", () => {
  it("prepends `> ` to every selected line", () => {
    const container = document.createElement("div");
    const doc = "alpha\nbeta\ngamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> alpha\n> beta\n> gamma");
    editor.destroy();
  });

  it("removes `> ` from every line when all are blockquotes", () => {
    const container = document.createElement("div");
    const doc = "> alpha\n> beta\n> gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("applies `> ` to all lines when selection is mixed", () => {
    const container = document.createElement("div");
    const doc = "> alpha\nbeta";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleBlockquote(editor);

    expect(editor.getDocument()).toBe("> alpha\n> beta");
    editor.destroy();
  });
});

describe("toggleHeading — multi-line", () => {
  it("applies the heading prefix to every selected line", () => {
    const container = document.createElement("div");
    const doc = "alpha\nbeta\ngamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("## alpha\n## beta\n## gamma");
    editor.destroy();
  });

  it("removes heading prefix when all selected lines are at the same level", () => {
    const container = document.createElement("div");
    const doc = "## alpha\n## beta\n## gamma";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("upgrades all selected headings to a new level", () => {
    const container = document.createElement("div");
    const doc = "## alpha\n## beta";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleHeading(editor, 1);

    expect(editor.getDocument()).toBe("# alpha\n# beta");
    editor.destroy();
  });

  it("applies heading when selection is mixed (some headed, some plain)", () => {
    const container = document.createElement("div");
    const doc = "## alpha\nbeta";
    const editor = createEditor({ container, initialValue: doc });

    editor.setSelection(0, doc.length);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("## alpha\n## beta");
    editor.destroy();
  });

  it("falls back to single-line behaviour when anchor === head", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Title" });

    editor.setSelection(2);
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
