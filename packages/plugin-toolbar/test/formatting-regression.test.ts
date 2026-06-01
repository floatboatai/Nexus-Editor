/**
 * Formatting regression harness for plugin-toolbar.
 *
 * Each FormattingCase captures one complete editor scenario:
 *   initial document + selection → command → expected document
 *
 * The `id` field appears verbatim in failure output, so a broken CI run
 * identifies the exact case without reading a diff. New commands can be
 * covered by appending entries to `cases` — no boilerplate required.
 *
 * Coverage goal: every exported formatting function that had zero tests.
 * Functions already covered in plugin-toolbar.test.ts (toggleBold,
 * toggleItalic, toggleInlineCode, toggleHeading, insertLink) are not
 * duplicated here except where a distinct edge-case is being verified.
 */

import type { EditorAPI } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import {
  applyHighlight,
  applyTextColor,
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  toggleBlockquote,
  toggleBold,
  toggleOrderedList,
  toggleStrikethrough,
  toggleUnorderedList,
} from "../src/index";

interface FormattingCase {
  /** Unique slug shown verbatim in assertion failure messages. */
  id: string;
  /** Initial markdown document. */
  input: string;
  /** Selection anchor (inclusive). */
  anchor: number;
  /** Selection head; omit for a point cursor (anchor === head). */
  head?: number;
  /** Formatting operation under test. */
  run: (editor: EditorAPI) => void;
  /** Expected document string after the operation. */
  expected: string;
}

function runCase(c: FormattingCase): void {
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue: c.input });
  editor.setSelection(c.anchor, c.head ?? c.anchor);
  c.run(editor);
  const actual = editor.getDocument();
  editor.destroy();
  expect(actual, `[${c.id}] input=${JSON.stringify(c.input)} anchor=${c.anchor} head=${c.head}`).toBe(c.expected);
}

const cases: FormattingCase[] = [
  // ── toggleStrikethrough ──────────────────────────────────────────────────

  {
    id: "strikethrough/wrap",
    input: "hello world",
    anchor: 6,
    head: 11,
    run: (e) => toggleStrikethrough(e),
    expected: "hello ~~world~~",
  },
  {
    id: "strikethrough/unwrap",
    input: "hello ~~world~~",
    anchor: 8,
    head: 13,
    run: (e) => toggleStrikethrough(e),
    expected: "hello world",
  },

  // ── toggleBlockquote ─────────────────────────────────────────────────────

  {
    id: "blockquote/add",
    input: "quote text",
    anchor: 5,
    run: (e) => toggleBlockquote(e),
    expected: "> quote text",
  },
  {
    id: "blockquote/remove",
    input: "> quoted",
    anchor: 5,
    run: (e) => toggleBlockquote(e),
    expected: "quoted",
  },
  {
    id: "blockquote/preserves-surrounding-lines",
    // Only the line containing the cursor should gain the prefix.
    input: "first\nsecond\nthird",
    anchor: 8,
    run: (e) => toggleBlockquote(e),
    expected: "first\n> second\nthird",
  },

  // ── toggleUnorderedList ───────────────────────────────────────────────────

  {
    id: "ulist/add",
    input: "plain text",
    anchor: 5,
    run: (e) => toggleUnorderedList(e),
    expected: "- plain text",
  },
  {
    id: "ulist/remove",
    input: "- list item",
    anchor: 5,
    run: (e) => toggleUnorderedList(e),
    expected: "list item",
  },
  {
    id: "ulist/converts-from-ordered",
    // Ordered marker "1. " is stripped and "- " is added.
    input: "1. item",
    anchor: 4,
    run: (e) => toggleUnorderedList(e),
    expected: "- item",
  },

  // ── toggleOrderedList ─────────────────────────────────────────────────────

  {
    id: "olist/add",
    input: "plain text",
    anchor: 5,
    run: (e) => toggleOrderedList(e),
    expected: "1. plain text",
  },
  {
    id: "olist/converts-from-unordered",
    // Unordered marker "- " is stripped and "1. " is added.
    input: "- item",
    anchor: 3,
    run: (e) => toggleOrderedList(e),
    expected: "1. item",
  },
  {
    id: "olist/remove",
    input: "1. item",
    anchor: 4,
    run: (e) => toggleOrderedList(e),
    expected: "item",
  },

  // ── insertCodeBlock ───────────────────────────────────────────────────────

  {
    id: "code-block/wraps-selection",
    // Selected text becomes the body; no extra newlines needed at doc start.
    input: "hello world",
    anchor: 0,
    head: 11,
    run: (e) => insertCodeBlock(e),
    expected: "```\nhello world\n```",
  },
  {
    id: "code-block/empty-selection-on-blank-line",
    // Cursor sits on the blank line between two paragraphs; previous char is
    // '\n' so no extra leading newline is injected.
    input: "before\n\nafter",
    anchor: 7,
    run: (e) => insertCodeBlock(e),
    expected: "before\n```\n\n```\nafter",
  },
  {
    id: "code-block/appends-newline-when-cursor-is-mid-word",
    // Previous char is not '\n', so a newline is prepended to the fence.
    input: "intro text",
    anchor: 10,
    run: (e) => insertCodeBlock(e),
    expected: "intro text\n```\n\n```",
  },

  // ── insertHorizontalRule ──────────────────────────────────────────────────

  {
    id: "hr/appends-after-non-newline",
    // Cursor at end of a line that has no trailing newline → rule gets one.
    input: "text",
    anchor: 4,
    run: (e) => insertHorizontalRule(e),
    expected: "text\n---\n",
  },
  {
    id: "hr/no-extra-newline-when-previous-char-is-newline",
    // Previous char is already '\n'; no duplicate newline before "---".
    input: "line one\n",
    anchor: 9,
    run: (e) => insertHorizontalRule(e),
    expected: "line one\n---\n",
  },

  // ── insertImage ───────────────────────────────────────────────────────────

  {
    id: "image/uses-selection-as-alt-text",
    input: "click here",
    anchor: 6,
    head: 10,
    run: (e) => insertImage(e),
    expected: "click ![here](url)",
  },
  {
    id: "image/default-alt-when-no-selection",
    input: "text ",
    anchor: 5,
    run: (e) => insertImage(e),
    expected: "text ![alt text](url)",
  },

  // ── applyTextColor ────────────────────────────────────────────────────────

  {
    id: "text-color/wraps-selection-in-span",
    input: "hello world",
    anchor: 6,
    head: 11,
    run: (e) => applyTextColor(e, "red"),
    expected: 'hello <span style="color:red">world</span>',
  },
  {
    id: "text-color/no-op-on-empty-selection",
    // from === to → function returns false, document is unchanged.
    input: "hello",
    anchor: 3,
    run: (e) => applyTextColor(e, "red"),
    expected: "hello",
  },

  // ── applyHighlight ────────────────────────────────────────────────────────

  {
    id: "highlight/wraps-selection-in-mark",
    input: "hello world",
    anchor: 6,
    head: 11,
    run: (e) => applyHighlight(e, "yellow"),
    expected: 'hello <mark style="background:yellow">world</mark>',
  },
  {
    id: "highlight/no-op-on-empty-selection",
    input: "hello",
    anchor: 3,
    run: (e) => applyHighlight(e, "yellow"),
    expected: "hello",
  },

  // ── Edge cases ────────────────────────────────────────────────────────────

  {
    id: "bold/wraps-at-document-start",
    // from === 0, so doc.slice(max(0, -2), 0) is empty — the "already wrapped"
    // check must not fire and the text must be wrapped correctly.
    input: "hello",
    anchor: 0,
    head: 5,
    run: (e) => toggleBold(e),
    expected: "**hello**",
  },
];

describe("formatting regression harness", () => {
  for (const c of cases) {
    it(c.id, () => runCase(c));
  }
});

// ── Round-trip tests ──────────────────────────────────────────────────────────
//
// toggleWrap shifts the selection by marker.length after wrapping, so the
// second call receives a selection that already points inside the markers.
// No manual setSelection() is needed between the two calls.

describe("formatting round-trips", () => {
  it("toggleStrikethrough applied twice restores original document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });
    editor.setSelection(6, 11);
    toggleStrikethrough(editor); // → "hello ~~world~~", selection shifts to 8–13
    toggleStrikethrough(editor); // unwraps on current selection
    expect(editor.getDocument()).toBe("hello world");
    editor.destroy();
  });

  it("toggleBold applied twice restores original document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "foo bar" });
    editor.setSelection(4, 7);
    toggleBold(editor); // → "foo **bar**", selection shifts to 6–9
    toggleBold(editor); // unwraps on current selection
    expect(editor.getDocument()).toBe("foo bar");
    editor.destroy();
  });
});
