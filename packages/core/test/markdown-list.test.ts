import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";
import { createMarkdownLanguageSupport } from "../src/lezer-markdown";
import { handleMarkdownEnter, markdownKeymap } from "../src/markdown-keymap";
import { backspaceListItem, indentListItem, outdentListItem } from "../src/markdown-list";

/**
 * `|` marks a cursor and `⟦…⟧` a selection range in the fixture string; the
 * markers are stripped before the document is created.
 */
function createView(fixture: string, extraExtensions: Extension[] = []): EditorView {
  const ranges: { anchor: number; head: number }[] = [];
  let doc = "";
  let anchor: number | null = null;

  for (const char of fixture) {
    if (char === "|") {
      ranges.push({ anchor: doc.length, head: doc.length });
    } else if (char === "⟦") {
      anchor = doc.length;
    } else if (char === "⟧") {
      ranges.push({ anchor: anchor ?? doc.length, head: doc.length });
      anchor = null;
    } else {
      doc += char;
    }
  }

  return new EditorView({
    state: EditorState.create({
      doc,
      selection: ranges.length > 0
        ? EditorSelection.create(ranges.map((range) => EditorSelection.range(range.anchor, range.head)))
        : undefined,
      extensions: [createMarkdownLanguageSupport(), EditorState.allowMultipleSelections.of(true), ...extraExtensions],
    }),
  });
}

function textAround(view: EditorView, radius = 1): string {
  const head = view.state.selection.main.head;
  return view.state.doc.sliceString(head - radius, head + radius);
}

describe("indentListItem", () => {
  it("nests a bullet item under its previous sibling", () => {
    const view = createView("- a\n- b|");
    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n  - b");
    view.destroy();
  });

  it("indents to the previous sibling's content column and restarts the nested count", () => {
    const view = createView("1. a\n2. b|\n3. c");
    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n   1. b\n2. c");
    view.destroy();
  });

  it("uses the width of a wide ordered marker", () => {
    const view = createView("10. a\n11. b|");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("10. a\n    1. b");
    view.destroy();
  });

  it("keeps a custom start number on the untouched outer list", () => {
    const view = createView("5. a\n6. b|\n7. c");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("5. a\n   1. b\n6. c");
    view.destroy();
  });

  it("joins the previous sibling's existing nested list", () => {
    const view = createView("1. a\n   1. x\n2. b|\n3. c");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n   1. x\n   2. b\n2. c");
    view.destroy();
  });

  it("moves nested children and continuation lines with the item", () => {
    const view = createView("- a\n- b|\n  - c\n  more b");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n    - c\n    more b");
    view.destroy();
  });

  it("leaves blank lines inside a loose item untouched", () => {
    const view = createView("- a\n- b|\n\n  para\n- c");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n\n    para\n- c");
    view.destroy();
  });

  it("keeps task checkboxes", () => {
    const view = createView("- [ ] a\n- [x] b|");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- [ ] a\n  - [x] b");
    view.destroy();
  });

  it("indents after the blockquote prefix", () => {
    const view = createView("> - a\n> - b|\n>   more b");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("> - a\n>   - b\n>     more b");
    view.destroy();
  });

  it("nests under the last item of a preceding list with a different marker", () => {
    const view = createView("1. a\n- b|");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n   - b");
    view.destroy();
  });

  it("consumes the key without changes for the first item of a list", () => {
    const view = createView("- a|\n- b");
    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    view.destroy();
  });

  it("returns false on a plain text line so Tab falls through", () => {
    const view = createView("plain|\n- a");
    expect(indentListItem(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("plain\n- a");
    view.destroy();
  });

  it("returns false on a continuation line that is not an item start", () => {
    const view = createView("- a\n  more|");
    expect(indentListItem(view)).toBe(false);
    view.destroy();
  });

  it("indents consecutive selected siblings as one unit", () => {
    const view = createView("- a\n- ⟦b\n- c⟧\n- d");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n  - c\n- d");
    view.destroy();
  });

  it("does not treat a selection ending at a line start as touching that line", () => {
    const view = createView("- a\n⟦- b\n⟧- c");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n- c");
    view.destroy();
  });

  it("ignores a selected child whose parent is also selected", () => {
    const view = createView("- a\n- ⟦b\n  - c⟧");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n    - c");
    view.destroy();
  });

  it("handles cursors in separate lists in one transaction", () => {
    const view = createView("1. a\n2. b|\n\ntext\n\n- x\n- y|");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n   1. b\n\ntext\n\n- x\n  - y");
    view.destroy();
  });

  it("keeps the cursor on the same character", () => {
    const view = createView("- a\n- b|c");
    indentListItem(view);
    expect(textAround(view)).toBe("bc");
    view.destroy();
  });

  it("undoes the indent and the renumbering in one step", () => {
    const view = createView("1. a\n2. b|\n3. c", [history()]);
    indentListItem(view);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n2. b\n3. c");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n   1. b\n2. c");
    view.destroy();
  });

  it("does nothing in a read-only state", () => {
    const view = createView("- a\n- b|", [EditorState.readOnly.of(true)]);
    expect(indentListItem(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    view.destroy();
  });

  it("does not nest under a list that ends before a blank line", () => {
    const view = createView("1. a\n\n- b|");
    expect(indentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n\n- b");
    view.destroy();
  });

  it("measures a tab-indented anchor in columns and rewrites the moved line with spaces", () => {
    const view = createView("- a\n\t- b\n\t- c|");
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n\t- b\n      - c");
    view.destroy();
  });

  it("uses the editor's tab size for tab columns", () => {
    const view = createView("- a\n\t- b\n\t- c|", [EditorState.tabSize.of(2)]);
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n\t- b\n    - c");
    view.destroy();
  });

  it("ignores list-looking lines inside a fenced code block", () => {
    const view = createView("```\n- a\n- b|\n```");
    expect(indentListItem(view)).toBe(false);
    view.destroy();
  });
});

describe("outdentListItem", () => {
  it("lifts a nested bullet to its parent's level", () => {
    const view = createView("- a\n  - b|");
    expect(outdentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    view.destroy();
  });

  it("renumbers the destination list and turns following siblings into children", () => {
    const view = createView("1. a\n   1. x|\n   2. y\n2. b");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. x\n   1. y\n3. b");
    view.destroy();
  });

  it("restarts a list that opens after a bullet list and re-aligns children to the new marker width", () => {
    const view = createView("- a\n\n  10. x|\n  11. y");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n\n1. x\n   1. y");
    view.destroy();
  });

  it("keeps the outer list's custom start number", () => {
    const view = createView("5. a\n   1. x|\n6. b");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("5. a\n6. x\n7. b");
    view.destroy();
  });

  it("moves nested children with the item", () => {
    const view = createView("- a\n  - b|\n    - c\n- d");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n- b\n  - c\n- d");
    view.destroy();
  });

  it("outdents one level at a time from a deeply nested item", () => {
    const view = createView("- a\n  - b\n    - c|");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n  - b\n  - c");
    view.destroy();
  });

  it("strips stray indentation from a top-level item", () => {
    const view = createView("  - a|");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a");
    view.destroy();
  });

  it("consumes the key without changes for a top-level item", () => {
    const view = createView("- a\n- b|");
    expect(outdentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    view.destroy();
  });

  it("returns false on a plain text line", () => {
    const view = createView("  plain|");
    expect(outdentListItem(view)).toBe(false);
    view.destroy();
  });

  it("outdents inside a blockquote", () => {
    const view = createView("> - a\n>   - b|\n>     more b");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("> - a\n> - b\n>   more b");
    view.destroy();
  });

  it("outdents consecutive selected siblings together", () => {
    const view = createView("- a\n  - ⟦b\n  - c⟧\n  - d");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n- b\n- c\n  - d");
    view.destroy();
  });

  it("keeps the cursor on the same character", () => {
    const view = createView("- a\n  - b|c");
    outdentListItem(view);
    expect(textAround(view)).toBe("bc");
    view.destroy();
  });

  it("round-trips with indentListItem", () => {
    const view = createView("1. a\n2. b|\n3. c");
    indentListItem(view);
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. b\n3. c");
    view.destroy();
  });

  it("undoes the outdent in one step", () => {
    const view = createView("1. a\n   1. x|\n   2. y\n2. b", [history()]);
    outdentListItem(view);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n   1. x\n   2. y\n2. b");
    view.destroy();
  });

  it("removes tab indentation by column width", () => {
    const view = createView("- a\n\t- b|");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    view.destroy();
  });

  it("rewrites a partially removed tab indent as spaces", () => {
    const view = createView("- a\n\t- b\n\t\t- c|");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n\t- b\n    - c");
    view.destroy();
  });

  it("applies a later cursor's move over an earlier item's follower alignment", () => {
    const view = createView("- a\n\n  10. x|\n  11. y\n  12. z|");
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n\n1. x\n   1. y\n2. z");
    view.destroy();
  });
});

describe("backspaceListItem", () => {
  it("turns a top-level item into plain text", () => {
    const view = createView("- |a");
    expect(backspaceListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a");
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  it("removes the task box with the marker", () => {
    const view = createView("- [ ] |task");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("task");
    view.destroy();
  });

  it("empties an empty item", () => {
    const view = createView("- |");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("renumbers the list that continues after the unlisted line", () => {
    const view = createView("1. a\n2. |b\n3. c");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\nb\n2. c");
    view.destroy();
  });

  it("restarts the list that follows a removed first item", () => {
    const view = createView("1. |a\n2. b\n3. c");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("a\n1. b\n2. c");
    view.destroy();
  });

  it("moves nested lines left so they do not become an indented code block", () => {
    const view = createView("10. |a\n    - child\n    more");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("a\n- child\nmore");
    view.destroy();
  });

  it("outdents a nested item instead of removing its marker", () => {
    const view = createView("- a\n  - |b");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("- a\n- b");
    expect(textAround(view, 1)).toBe(" b");
    view.destroy();
  });

  it("outdents a nested ordered item and re-parents its followers", () => {
    const view = createView("1. a\n   1. |x\n   2. y\n2. b");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. x\n   1. y\n3. b");
    view.destroy();
  });

  it("strips the marker after a blockquote prefix", () => {
    const view = createView("> - |a\n> - b");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("> a\n> - b");
    view.destroy();
  });

  it("handles cursors in separate lists", () => {
    const view = createView("- |a\n\ntext\n\n- x\n  - |y");
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("a\n\ntext\n\n- x\n- y");
    view.destroy();
  });

  it("returns false when a cursor is not at the content start", () => {
    for (const fixture of ["- a|", "-| a", "|- a", "- a\n  more|"]) {
      const view = createView(fixture);
      expect(backspaceListItem(view)).toBe(false);
      view.destroy();
    }
  });

  it("returns false for a non-empty selection", () => {
    const view = createView("- ⟦a⟧");
    expect(backspaceListItem(view)).toBe(false);
    view.destroy();
  });

  it("returns false inside a fenced code block", () => {
    const view = createView("```\n- |a\n```");
    expect(backspaceListItem(view)).toBe(false);
    view.destroy();
  });

  it("does nothing in a read-only state", () => {
    const view = createView("- |a", [EditorState.readOnly.of(true)]);
    expect(backspaceListItem(view)).toBe(false);
    view.destroy();
  });

  it("undoes in one step", () => {
    const view = createView("1. |a\n2. b", [history()]);
    backspaceListItem(view);
    expect(view.state.doc.toString()).toBe("a\n1. b");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n2. b");
    view.destroy();
  });
});

describe("ordered list renumbering on Enter", () => {
  it("renumbers the items after a newly inserted one", () => {
    const view = createView("1. a|\n2. b\n3. c");
    expect(handleMarkdownEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n2. \n3. b\n4. c");
    view.destroy();
  });

  it("renumbers the items after an emptied one", () => {
    const view = createView("1. a\n2. |\n3. c");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("1. a\n\n2. c");
    view.destroy();
  });

  it("renumbers only the nested list the cursor is in", () => {
    const view = createView("1. a\n   1. x|\n   2. y\n2. b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("1. a\n   1. x\n   2. \n   3. y\n2. b");
    view.destroy();
  });

  it("re-indents children when a marker grows a digit", () => {
    const items = (from: number, count: number): string =>
      Array.from({ length: count }, (_, i) => `${from + i}. item`).join("\n");
    const view = createView(`1. a|\n${items(1, 9)}\n   - child of nine`);
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe(`1. a\n2. \n${items(3, 9)}\n    - child of nine`);
    view.destroy();
  });

  it("continues and renumbers a list inside a blockquote", () => {
    const view = createView("> 1. a|\n> 2. b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("> 1. a\n> 2. \n> 3. b");

    const bullets = createView("> - [ ] a|");
    handleMarkdownEnter(bullets);
    expect(bullets.state.doc.toString()).toBe("> - [ ] a\n> - [ ] ");
    view.destroy();
    bullets.destroy();
  });

  it("does not renumber a list with a mismatched delimiter", () => {
    const view = createView("1. a|\n2) b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. \n2) b");
    view.destroy();
  });

  it("leaves bullet lists alone", () => {
    const view = createView("- a|\n- b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("- a\n- \n- b");
    view.destroy();
  });

  it("stays a single undo step", () => {
    const view = createView("1. a|\n2. b", [history()]);
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("1. a\n2. \n3. b");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. a\n2. b");
    view.destroy();
  });

  it("stops renumbering at the nine-digit marker limit", () => {
    const view = createView("999999999. a|\n1. b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("999999999. a\n1000000000. \n1. b");
    view.destroy();
  });

  it("pushes the item down when the cursor is before its content", () => {
    const view = createView("|1. a\n2. b");
    handleMarkdownEnter(view);
    expect(view.state.doc.toString()).toBe("\n1. a\n2. b");
    expect(view.state.selection.main.head).toBe(1);

    const inMarker = createView("- [ ]| task");
    handleMarkdownEnter(inMarker);
    expect(inMarker.state.doc.toString()).toBe("\n- [ ] task");
    view.destroy();
    inMarker.destroy();
  });

  it("does not continue a list-looking line inside a fenced code block", () => {
    const view = createView("```md\n- item|\n```");
    expect(handleMarkdownEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("```md\n- item\n```");
    view.destroy();
  });

  it("does nothing in a read-only state", () => {
    const view = createView("- a|", [EditorState.readOnly.of(true)]);
    expect(handleMarkdownEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("- a");
    view.destroy();
  });
});

describe("markdownKeymap Tab bindings", () => {
  function keydown(target: Element | null, init: KeyboardEventInit): void {
    target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  }

  it("binds Tab and Shift-Tab to list indentation", () => {
    const view = createView("1. a\n2. b|", [markdownKeymap()]);
    keydown(view.contentDOM, { key: "Tab" });
    expect(view.state.doc.toString()).toBe("1. a\n   1. b");
    keydown(view.contentDOM, { key: "Tab", shiftKey: true });
    expect(view.state.doc.toString()).toBe("1. a\n2. b");
    view.destroy();
  });

  it("binds Backspace at the content start and leaves other positions alone", () => {
    const view = createView("- a\n  - |b", [markdownKeymap()]);
    keydown(view.contentDOM, { key: "Backspace" });
    expect(view.state.doc.toString()).toBe("- a\n- b");
    keydown(view.contentDOM, { key: "Backspace" });
    expect(view.state.doc.toString()).toBe("- a\nb");
    view.destroy();
  });

  it("indents ordered lists to a real nesting level through createEditor", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. a\n2. b\n3. c",
      plugins: [createGfmPreset()],
    });
    editor.setSelection(7);
    keydown(container.querySelector(".cm-content"), { key: "Tab" });

    expect(editor.getDocument()).toBe("1. a\n   1. b\n2. c");
    const list = editor.getAst().children[0];
    expect(list.type).toBe("list");
    expect(list.type === "list" ? list.children.length : 0).toBe(2);
    editor.destroy();
  });
});
