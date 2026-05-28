import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  toggleStrikethrough,
  toggleUnderline,
  applyTextColor,
  applyHighlight,
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

  it("does not mistake bold markers for italic in multi-line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**aaa**\n**bbb**",
    });

    editor.setSelection(0, 15);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***aaa***\n***bbb***");
    editor.destroy();
  });

  it("strips italic markers without touching bold in mixed content", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "*aaa*\n**bbb**",
    });

    editor.setSelection(0, 13);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("*aaa*\n***bbb***");
    editor.destroy();
  });

  it("strips one layer from triple-star (bold+italic) in multi-line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "***ccc***\n***ddd***",
    });

    editor.setSelection(0, 19);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("**ccc**\n**ddd**");
    editor.destroy();
  });

  it("wraps bold-only content with italic without stripping bold", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**abc**",
    });

    editor.setSelection(0, 7);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***abc***");
    editor.destroy();
  });

  it("adds italic to bold text when partially selected (star-count path)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "**abc**" });

    editor.setSelection(1, 7);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***abc***");
    editor.destroy();
  });

  it("adds italic to bold-only multi-line without stripping bold", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**a1**\n**a2**",
    });

    editor.setSelection(0, 13);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***a1***\n***a2***");
    editor.destroy();
  });

  it("removes italic from bold+italic multi-line keeping bold", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "***a1***\n***a2***",
    });

    editor.setSelection(0, 17);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("**a1**\n**a2**");
    editor.destroy();
  });

  it("adds italic to bold-only multi-line with partial first-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**a1**\n**a2**",
    });

    editor.setSelection(1, 13);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***a1***\n***a2***");
    editor.destroy();
  });

  it("wraps inner selection in bold region with italic", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**abc**",
    });

    editor.setSelection(2, 5);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("***abc***");
    editor.destroy();
  });

  it("strips one layer from triple-star when inner text selected", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "***abc***",
    });

    editor.setSelection(3, 6);
    toggleItalic(editor);

    expect(editor.getDocument()).toBe("**abc**");
    editor.destroy();
  });
});

describe("multi-line star-count", () => {
  it("handles asymmetric stars across multi-line selection", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "**ab***\n***cd***",
    });
    e.setSelection(2, 16);
    toggleItalic(e);
    expect(e.getDocument()).toBe("***ab**\n**cd**");
    e.destroy();
  });
});

describe("star-count boundary rules", () => {
  it("* wraps 0 stars → 1 star for italic", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "abc" });
    e.setSelection(0, 3);
    toggleItalic(e);
    expect(e.getDocument()).toBe("*abc*");
    e.destroy();
  });

  it("* unwraps 1 star → 0 stars for italic", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "*abc*" });
    e.setSelection(1, 4);
    toggleItalic(e);
    expect(e.getDocument()).toBe("abc");
    e.destroy();
  });

  it("* wraps 2 stars → 3 stars for italic", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "**abc**" });
    e.setSelection(2, 5);
    toggleItalic(e);
    expect(e.getDocument()).toBe("***abc***");
    e.destroy();
  });

  it("* unwraps 3 stars → 2 stars for italic", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "***abc***" });
    e.setSelection(3, 6);
    toggleItalic(e);
    expect(e.getDocument()).toBe("**abc**");
    e.destroy();
  });

  it("** wraps 0 stars → 2 stars for bold", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "abc" });
    e.setSelection(0, 3);
    toggleBold(e);
    expect(e.getDocument()).toBe("**abc**");
    e.destroy();
  });

  it("** wraps 1 star → 3 stars for bold", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "*abc*" });
    e.setSelection(1, 4);
    toggleBold(e);
    expect(e.getDocument()).toBe("***abc***");
    e.destroy();
  });

  it("** unwraps 2 stars → 0 stars for bold", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "**abc**" });
    e.setSelection(2, 5);
    toggleBold(e);
    expect(e.getDocument()).toBe("abc");
    e.destroy();
  });

  it("** unwraps 3 stars → 1 star for bold", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "***abc***" });
    e.setSelection(3, 6);
    toggleBold(e);
    expect(e.getDocument()).toBe("*abc*");
    e.destroy();
  });
  it("asymmetric: left has stars, right has none → independent adjust for italic", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "***abc***" });
    e.setSelection(1, 5);
    toggleItalic(e);
    expect(e.getDocument()).toBe("**ab*c***");
    e.destroy();
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

describe("toggleInlineCode multi-line", () => {
  it("wraps each line with backticks", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    toggleInlineCode(e);
    expect(e.getDocument()).toBe("`a`\n`b`");
    e.destroy();
  });

  it("unwraps each line from backticks", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "`a`\n`b`" });
    e.setSelection(0, 7);
    toggleInlineCode(e);
    expect(e.getDocument()).toBe("a\nb");
    e.destroy();
  });

  it("partial selection across inline code lines", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "`a`\n`b`" });
    e.setSelection(1, 5);
    toggleInlineCode(e);
    expect(e.getDocument()).toBe("`a\n`b`");
    e.destroy();
  });

  it("partial selection on ordered list wraps selected portion", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "1. a\n1. bc\n1. def",
    });
    e.setSelection(9, 17);
    toggleInlineCode(e);
    expect(e.getDocument()).toBe("1. a\n1. b`c`\n1. `def`");
    e.destroy();
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

  it("applies heading to each line in multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb" });

    editor.setSelection(0, 3);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("## a\n## b");
    editor.destroy();
  });

  it("removes heading from each line in multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "## a\n## b" });

    editor.setSelection(0, 9);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("a\nb");
    editor.destroy();
  });

  it("applies heading to ordered list items, stripping list markers", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. first\n2. second",
    });

    editor.setSelection(0, 18);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("1. ## first\n2. ## second");
    editor.destroy();
  });

  it("applies heading to unordered list items, stripping list markers", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- first\n- second",
    });

    editor.setSelection(0, 16);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("- ## first\n- ## second");
    editor.destroy();
  });

  it("removes heading from list items with heading, keeping list markers", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. ## first\n2. ## second",
    });

    editor.setSelection(0, 24);
    toggleHeading(editor, 2);

    expect(editor.getDocument()).toBe("1. first\n2. second");
    editor.destroy();
  });
});

describe("toggleStrikethrough multi-line", () => {
  it("wraps each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("~~a~~\n~~b~~");
    e.destroy();
  });

  it("unwraps each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "~~a~~\n~~b~~" });
    e.setSelection(0, 11);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("a\nb");
    e.destroy();
  });

  it("partial selection across strikethrough lines", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "~~a~~\n~~b~~" });
    e.setSelection(2, 8);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("~~a\n~~b~~");
    e.destroy();
  });

  it("partial selection maintains orphaned markers", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "~~a~~\n~~bc~~" });
    e.setSelection(3, 9);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("~~a\nb~~c~~");
    e.destroy();
  });

  it("partial selection on ordered list wraps selected portion", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "1. a\n1. bc\n1. def",
    });
    e.setSelection(9, 17);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("1. a\n1. b~~c~~\n1. ~~def~~");
    e.destroy();
  });

  it("wraps bold-only content with strikethrough without stripping bold", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "**a**\n**b**" });
    e.setSelection(0, 11);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("~~**a**~~\n~~**b**~~");
    e.destroy();
  });

  it("wraps bold-only CJK content with strikethrough correctly", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "**滴答**\n**滴答**",
    });
    e.setSelection(0, 13);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("~~**滴答**~~\n~~**滴答**~~");
    e.destroy();
  });

  it("partial selection on bold content leaves unselected bold markers intact", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "**a**\n**b**" });
    e.setSelection(1, 11);
    toggleStrikethrough(e);
    expect(e.getDocument()).toBe("*~~*a**~~\n~~**b**~~");
    e.destroy();
  });
});

describe("toggleUnderline multi-line", () => {
  it("wraps each line with <u>", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    toggleUnderline(e);
    expect(e.getDocument()).toBe("<u>a</u>\n<u>b</u>");
    e.destroy();
  });

  it("unwraps each line from <u>", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "<u>a</u>\n<u>b</u>",
    });
    e.setSelection(0, 17);
    toggleUnderline(e);
    expect(e.getDocument()).toBe("a\nb");
    e.destroy();
  });

  it("wraps list items without touching list markers", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "- a\n- b",
    });
    e.setSelection(0, 7);
    toggleUnderline(e);
    expect(e.getDocument()).toBe("- <u>a</u>\n- <u>b</u>");
    e.destroy();
  });

  it("unwraps list items without touching list markers", () => {
    const c = document.createElement("div");
    const e = createEditor({
      container: c,
      initialValue: "- <u>a</u>\n- <u>b</u>",
    });
    e.setSelection(0, 19);
    toggleUnderline(e);
    expect(e.getDocument()).toBe("- a\n- b");
    e.destroy();
  });
});

describe("applyTextColor multi-line", () => {
  it("wraps each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    applyTextColor(e, "red");
    expect(e.getDocument()).toBe(
      '<span style="color:red">a</span>\n<span style="color:red">b</span>',
    );
    e.destroy();
  });

  it("skips list markers", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "1. a\n1. b" });
    e.setSelection(0, 9);
    applyTextColor(e, "blue");
    expect(e.getDocument()).toBe(
      '1. <span style="color:blue">a</span>\n1. <span style="color:blue">b</span>',
    );
    e.destroy();
  });

  it("partial selection per line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "abc\ndef" });
    e.setSelection(1, 6);
    applyTextColor(e, "green");
    expect(e.getDocument()).toBe(
      'a<span style="color:green">bc</span>\n<span style="color:green">de</span>f',
    );
    e.destroy();
  });
});

describe("applyHighlight multi-line", () => {
  it("wraps each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    applyHighlight(e, "yellow");
    expect(e.getDocument()).toBe(
      '<mark style="background:yellow">a</mark>\n<mark style="background:yellow">b</mark>',
    );
    e.destroy();
  });

  it("skips list markers", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "- a\n- b" });
    e.setSelection(0, 7);
    applyHighlight(e, "#ff0");
    expect(e.getDocument()).toBe(
      '- <mark style="background:#ff0">a</mark>\n- <mark style="background:#ff0">b</mark>',
    );
    e.destroy();
  });

  it("partial selection per line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "abc\ndef" });
    e.setSelection(1, 6);
    applyHighlight(e, "#ff0");
    expect(e.getDocument()).toBe(
      'a<mark style="background:#ff0">bc</mark>\n<mark style="background:#ff0">de</mark>f',
    );
    e.destroy();
  });
});

describe("toggleBlockquote multi-line", () => {
  it("adds > prefix to each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "a\nb" });
    e.setSelection(0, 3);
    toggleBlockquote(e);
    expect(e.getDocument()).toBe("> a\n> b");
    e.destroy();
  });

  it("removes > prefix from each line", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "> a\n> b" });
    e.setSelection(0, 7);
    toggleBlockquote(e);
    expect(e.getDocument()).toBe("a\nb");
    e.destroy();
  });

  it("does not treat empty > as quoted", () => {
    const c = document.createElement("div");
    const e = createEditor({ container: c, initialValue: "> \n> b" });
    e.setSelection(0, 6);
    toggleBlockquote(e);
    expect(e.getDocument()).toBe("> > \n> > b");
    e.destroy();
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
    expect(ids).toEqual(
      expect.arrayContaining(["h1", "h2", "bold", "image", "hr"]),
    );
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

    const button = toolbar.element.querySelector<HTMLButtonElement>(
      '[data-toolbar-action="unordered-list"]',
    );
    expect(button).not.toBeNull();
    expect(button?.title).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Unordered list");
    expect(button?.dataset.toolbarTooltip).toBe("Unordered list");
    expect(button?.getAttribute("aria-describedby")).toMatch(
      /^nexus-toolbar-tooltip-/,
    );

    button?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.getElementById(
      button?.getAttribute("aria-describedby") ?? "",
    );
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.textContent).toBe("Unordered list");

    button?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(
      document.getElementById(button?.getAttribute("aria-describedby") ?? ""),
    ).toBeNull();

    toolbar.destroy();
    editor.destroy();
  });
});

describe("toggleOrderedList", () => {
  it("adds ordered prefix to current line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(0);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. hello");
    editor.destroy();
  });

  it("removes ordered prefix when already OL", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. hello" });

    editor.setSelection(3);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("switches UL to OL on single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- hello" });

    editor.setSelection(2);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. hello");
    editor.destroy();
  });

  it("adds ordered prefix to all selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb\nc" });

    editor.setSelection(0, 5);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. a\n1. b\n1. c");
    editor.destroy();
  });

  it("removes ordered prefix from all selected OL lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. a\n2. b\n3. c",
    });

    editor.setSelection(0, 13);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("a\nb\nc");
    editor.destroy();
  });

  it("switches all selected lines to OL even when mixed", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. a\n- b\nc" });

    editor.setSelection(0, 9);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. a\n1. b\n1. c");
    editor.destroy();
  });

  it("does not add prefix to empty lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\n\nc" });

    editor.setSelection(0, 4);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("1. a\n\n1. c");
    editor.destroy();
  });

  it("preserves indentation of selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "  1. a\n  - b" });

    editor.setSelection(0, 12);
    toggleOrderedList(editor);

    expect(editor.getDocument()).toBe("  1. a\n  1. b");
    editor.destroy();
  });
});

describe("toggleUnorderedList", () => {
  it("adds unordered prefix to current line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.setSelection(0);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });

  it("removes unordered prefix when already UL", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "- hello" });

    editor.setSelection(2);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("switches OL to UL on single line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. hello" });

    editor.setSelection(3);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- hello");
    editor.destroy();
  });

  it("adds unordered prefix to all selected lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb\nc" });

    editor.setSelection(0, 5);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- a\n- b\n- c");
    editor.destroy();
  });

  it("switches all selected lines to UL even when mixed", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. a\n- b\nc" });

    editor.setSelection(0, 9);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- a\n- b\n- c");
    editor.destroy();
  });

  it("preserves checkbox when switching OL to UL", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. [x] done" });

    editor.setSelection(0);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- [x] done");
    editor.destroy();
  });

  it("does not add prefix to empty lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\n\nc" });

    editor.setSelection(0, 4);
    toggleUnorderedList(editor);

    expect(editor.getDocument()).toBe("- a\n\n- c");
    editor.destroy();
  });
});

describe("toggleBold multi-line", () => {
  it("wraps each line in multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\nb\nc" });

    editor.setSelection(0, 5);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**a**\n**b**\n**c**");
    editor.destroy();
  });

  it("removes bold from each wrapped line", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "**a**\n**b**" });

    editor.setSelection(0, 11);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("a\nb");
    editor.destroy();
  });

  it("wraps list item content without touching markers", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "1. aaa\n2. bbb" });

    editor.setSelection(0, 13);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("1. **aaa**\n2. **bbb**");
    editor.destroy();
  });

  it("removes bold from list item content", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. **aaa**\n2. **bbb**",
    });

    editor.setSelection(0, 21);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("1. aaa\n2. bbb");
    editor.destroy();
  });

  it("makes all lines bold when mixed", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "**a**\nb" });

    editor.setSelection(0, 7);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**a**\n**b**");
    editor.destroy();
  });

  it("preserves empty lines", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "a\n\nc" });

    editor.setSelection(0, 4);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**a**\n\n**c**");
    editor.destroy();
  });
});

describe("toggleBold cross-marker selection", () => {
  it("handles selection that excludes trailing marker", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello **world**" });

    editor.setSelection(0, 13);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello world**");
    editor.destroy();
  });

  it("handles selection starting inside marker", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "**hello** world" });

    editor.setSelection(2, 14);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello world**");
    editor.destroy();
  });

  it("unwraps when only inner content of bold is selected", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "aa **hello** bb" });

    editor.setSelection(3, 10);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("aa hello bb");
    editor.destroy();
  });

  it("splits bold at selection start when inside marked region", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**hello world**",
    });

    editor.setSelection(2, 6);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("hell**o world**");
    editor.destroy();
  });

  it("splits bold at selection end when inside marked region", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**hello world**",
    });

    editor.setSelection(7, 13);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("**hello** world");
    editor.destroy();
  });
});

describe("toggleBold multi-line partial selection", () => {
  it("strips markers from partial last line and preserves unselected bold", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. **aaa**\n2. **bbbb**",
    });

    editor.setSelection(0, 18);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("1. aaa\n2. bb**bb**");
    editor.destroy();
  });

  it("preserves unselected bold at start of first line", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. **aaa**\n2. **bbbb**",
    });

    editor.setSelection(4, 22);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("1. **aaa\n2. bbbb");
    editor.destroy();
  });

  it("re-wraps orphaned trailing bold after partial strip", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "**xxx**\n **yyyzzz**",
    });

    editor.setSelection(0, 14);
    toggleBold(editor);

    expect(editor.getDocument()).toBe("xxx\n yyy**zzz**");
    editor.destroy();
  });
});
