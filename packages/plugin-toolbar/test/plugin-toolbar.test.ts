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

  it("keeps the hover tooltip out of the document flow (no scrollbar/reflow on hover)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "hello world" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);

    const button = toolbar.element.querySelector<HTMLButtonElement>('[data-toolbar-action="unordered-list"]');
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
    expect(tooltip).not.toBeNull();
    // Regression guard: the tooltip is appended to document.body on hover.
    // Without an explicit out-of-flow position it becomes a static block
    // child that pushes the document taller (viewport scrollbar flicker and
    // width reflow exactly while hovering).
    expect(getComputedStyle(tooltip!).position).toBe("fixed");
    expect(tooltip!.style.left).not.toBe("");
    expect(tooltip!.style.top).not.toBe("");

    toolbar.destroy();
    editor.destroy();
    container.remove();
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

describe("createToolbarUI — single-row overflow folding", () => {
  function stubRowLayout(toolbar: HTMLElement, width: number) {
    // Simulate real geometry: toolbar padding 12px, buttons 30px wide,
    // separators 9px (1px + 4px margins), 2px flex gap between items.
    const children = Array.from(toolbar.children) as HTMLElement[];
    let x = 12;
    for (const el of children) {
      const w = el.classList.contains("nexus-toolbar-separator") ? 9 : 30;
      Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          ({ left: x, top: 0, right: x + w, bottom: 30, width: w, height: 30, x, y: 0, toJSON: () => ({}) }) as DOMRect,
      });
      x += w + 2;
    }
    Object.defineProperty(toolbar, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({ left: 0, top: 0, right: width, bottom: 42, width, height: 42, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    });
  }

  function countVisibleButtons(toolbar: HTMLElement): number {
    return Array.from(toolbar.querySelectorAll<HTMLElement>(".nexus-toolbar-btn")).filter(
      (b) => !b.classList.contains("nexus-toolbar-more") && b.style.display !== "none",
    ).length;
  }

  it("folds overflowing buttons and expands them into rows on more click", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "hello world" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);
    // Multi-row expansion relies on the container wrapping — a regression
    // guard against collapsing back to flex nowrap + overflow clipping.
    expect(toolbar.element.style.flexWrap).toBe("wrap");
    stubRowLayout(toolbar.element, 300); // ~11 of 18 buttons fit

    window.dispatchEvent(new Event("resize"));

    const more = toolbar.element.querySelector<HTMLButtonElement>(".nexus-toolbar-more");
    expect(more).not.toBeNull();
    expect(more!.style.display).not.toBe("none");
    expect(more!.getAttribute("aria-expanded")).toBe("false");

    const folded = Array.from(
      toolbar.element.querySelectorAll<HTMLElement>("[data-toolbar-action]"),
    ).filter((b) => b.style.display === "none");
    expect(folded.length).toBeGreaterThan(0);

    // Clicking "more" expands every button inside the toolbar (no dropdown).
    more!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".nexus-toolbar-overflow-menu")).toBeNull();
    expect(more!.getAttribute("aria-expanded")).toBe("true");
    const totalButtons = toolbar.element.querySelectorAll("[data-toolbar-action]").length;
    expect(countVisibleButtons(toolbar.element)).toBe(totalButtons);
    // Expanded buttons stay inside the toolbar row (wrapping), not in a menu.
    expect(toolbar.element.querySelectorAll(".nexus-toolbar-overflow-label")).toHaveLength(0);

    // Clicking again collapses back to the folded single row.
    more!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(more!.getAttribute("aria-expanded")).toBe("false");
    const refolded = Array.from(
      toolbar.element.querySelectorAll<HTMLElement>("[data-toolbar-action]"),
    ).filter((b) => b.style.display === "none");
    expect(refolded.length).toBeGreaterThan(0);

    toolbar.destroy();
    editor.destroy();
    container.remove();
  });

  it("runs the action of an expanded button and restores the row when space grows", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "hello world" });
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);
    stubRowLayout(toolbar.element, 300);

    window.dispatchEvent(new Event("resize"));
    const more = toolbar.element.querySelector<HTMLButtonElement>(".nexus-toolbar-more");
    more!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const bold = toolbar.element.querySelector<HTMLButtonElement>(
      '[data-toolbar-action="bold"]',
    );
    expect(bold).not.toBeNull();
    expect(bold!.style.display).not.toBe("none"); // revealed by the expand

    editor.setSelection(6, 11);
    bold!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.getDocument()).toBe("hello **world**");
    // No dropdown was ever created; the button lives in the toolbar row.
    expect(document.querySelector(".nexus-toolbar-overflow-menu")).toBeNull();

    // Widen the toolbar → the folded single row fits everything, more hides.
    stubRowLayout(toolbar.element, 2000);
    window.dispatchEvent(new Event("resize"));
    const moreAfter = toolbar.element.querySelector<HTMLElement>(".nexus-toolbar-more");
    expect(moreAfter!.style.display).toBe("none");
    const totalButtons = toolbar.element.querySelectorAll("[data-toolbar-action]").length;
    expect(countVisibleButtons(toolbar.element)).toBe(totalButtons);

    toolbar.destroy();
    editor.destroy();
    container.remove();
  });
});
