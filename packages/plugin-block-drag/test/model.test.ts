import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { createMarkdownLanguageSupport } from "../../core/src/lezer-markdown";
import { planBlockMove, readBlocks } from "../src/model";

function createState(doc: string, selection?: EditorSelection, extensions: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [createMarkdownLanguageSupport(), EditorState.allowMultipleSelections.of(true), ...extensions]
  });
}

function move(doc: string, source: number, gap: number): string | null {
  const state = createState(doc);
  const plan = planBlockMove(state, readBlocks(state), source, gap);
  return plan?.changes.apply(state.doc).toString() ?? null;
}

describe("Markdown block model", () => {
  it("reads full outermost containers and retains unsupported blocks as barriers", () => {
    const doc = [
      "# Heading", "paragraph", "- parent\n  - child", "> quote\n>\n> - nested",
      "```js\nconst a = 1;\n```", "    indented", "| a | b |\n| --- | --- |\n| x | y |",
      "***", "[ref]: https://example.com", "[^note]: footnote", "<div>html</div>"
    ].join("\n\n");
    const state = createState(doc);
    const blocks = readBlocks(state);
    expect(blocks.map(block => block.type)).toEqual([
      "ATXHeading1", "Paragraph", "BulletList", "Blockquote", "FencedCode", "CodeBlock", "Table",
      "HorizontalRule", "LinkReference", "LinkReference", "HTMLBlock"
    ]);
    expect(blocks.map(block => block.movable)).toEqual([
      true, true, true, true, true, true, true, true, false, false, false
    ]);
    expect(state.doc.sliceString(blocks[5].from, blocks[5].to)).toBe("    indented");
  });

  it("has no handles for empty documents or missing Markdown language", () => {
    expect(readBlocks(createState("\n  \n"))).toEqual([]);
    expect(readBlocks(EditorState.create({ doc: "paragraph" }))).toEqual([]);
  });

  it.each([
    [0, 3, "B\n\nC\n\nA"],
    [2, 0, "C\n\nA\n\nB"],
    [1, 0, "B\n\nA\n\nC"],
    [1, 3, "A\n\nC\n\nB"],
    [0, 2, "B\n\nA\n\nC"],
    [2, 1, "A\n\nC\n\nB"]
  ])("moves block %i to gap %i", (source, gap, expected) => {
    expect(move("A\n\nB\n\nC", source, gap)).toBe(expected);
  });

  it.each([
    "# Title", "Title\n====", "---", "![logo](logo.png)",
    "- [x] checked\n- [ ] open\n  - nested",
    "3. third\n4. fourth", "> first\n>\n> - nested",
    "```ts\nconst x = `hello`;\n```", "~~~~ python\nprint('hi')\n~~~~",
    "    const x = 1;\n    const y = 2;", "\tindented\n\tcode",
    "| a | b |\n| :--- | ---: |\n| x\\|y | z |",
    "  **bold** and [link](url)  \nnext line"
  ])("preserves raw source when moving %j", (block) => {
    expect(move(`before\n\n${block}\n\nafter`, 1, 0)).toBe(`${block}\n\nbefore\n\nafter`);
    expect(move(`before\n\n${block}\n\nafter`, 1, 3)).toBe(`before\n\nafter\n\n${block}`);
  });

  it("keeps leading and trailing whitespace and all existing separator bytes", () => {
    expect(move("\n \nA\n\n \nB\n\nC\n\n", 0, 3)).toBe("\n \nB\n\nC\n\n \nA\n\n");
    expect(move("A\n\nB\n\n", 1, 0)).toBe("B\n\nA\n\n");
    expect(move("A\n\nB", 1, 0)).toBe("B\n\nA");
  });

  it("uses normalized document positions for CRLF input", () => {
    const state = createState("A\r\n\r\nB\r\n");
    const plan = planBlockMove(state, readBlocks(state), 0, 2)!;
    expect(plan.changes.apply(state.doc).toString()).toBe("B\n\nA\n");
    expect(plan.movedFrom).toBe(3);
  });

  it("adds a blank line if removal would merge paragraphs", () => {
    expect(move("before\n# heading\nafter", 1, 0)).toBe("# heading\nbefore\n\nafter");
  });

  it("adds a blank line if insertion would turn a thematic break into a setext heading", () => {
    expect(move("# Heading\n---\ntext", 1, 3)).toBe("# Heading\ntext\n\n---");
  });

  it("retains single newlines when the structure already stays intact", () => {
    expect(move("# A\n## B\n### C", 0, 3)).toBe("## B\n### C\n# A");
  });

  it("rejects an insertion that merges independent lists", () => {
    expect(move("- first\n\nseparator\n\n- second", 2, 1)).toBeNull();
  });

  it("rejects a removal that merges independent lists", () => {
    expect(move("- first\n\nseparator\n\n- second\n\nlast", 1, 4)).toBeNull();
  });

  it("keeps blockquotes separate, adding a blank line when required", () => {
    expect(move("> first\n\nseparator\n\n> second", 2, 1)).toBe("> first\n\n> second\n\nseparator");
    expect(move("> first\n# heading\n> second", 1, 3)).toBe("> first\n\n> second\n# heading");
  });

  it("rejects indented code being absorbed into a list even if root types look plausible", () => {
    expect(move("- list\n\nseparator\n\n    code", 2, 1)).toBeNull();
  });

  it("rejects an unterminated fence swallowing neighboring content", () => {
    expect(move("first\n\nsecond\n\n```js\nunclosed", 2, 0)).toBeNull();
  });

  it("retains link definitions and their spelling when other blocks move", () => {
    expect(move("[x]: /path 'title'\n\nparagraph [x]\n\nlast", 1, 3))
      .toBe("[x]: /path 'title'\n\nlast\n\nparagraph [x]");
    expect(move("[x]: /path\n\nparagraph", 0, 2)).toBeNull();
  });

  it("uses the configured Markdown dialect instead of a second default parser", () => {
    const state = createState("before\n\n| x |\n| --- |\n| ~~gone~~ |\n\nafter");
    const plan = planBlockMove(state, readBlocks(state), 0, 3)!;
    expect(plan.changes.apply(state.doc).toString()).toBe("| x |\n| --- |\n| ~~gone~~ |\n\nafter\n\nbefore");
  });

  it.each([[0, 0], [0, 1], [1, 1], [1, 2], [-1, 2], [3, 0], [0, -1], [0, 4], [0.5, 3], [0, NaN]])(
    "rejects no-op or invalid indexes %s, %s", (source, gap) => {
      expect(move("A\n\nB\n\nC", source, gap)).toBeNull();
    }
  );

  it("rejects stale ranges and synthetic unsupported-block overrides", () => {
    const state = createState("A\n\nB\n\nC");
    const blocks = readBlocks(state);
    const changed = state.update({ changes: { from: 0, insert: "more " } }).state;
    expect(planBlockMove(changed, blocks, 0, 3)).toBeNull();
    const unsupported = createState("[x]: /path\n\nA");
    expect(planBlockMove(unsupported, readBlocks(unsupported).map(block => ({ ...block, movable: true })), 0, 2))
      .toBeNull();
  });

  it("moves forward and backward selections with their source text", () => {
    for (const range of [EditorSelection.range(1, 4), EditorSelection.range(4, 1)]) {
      const state = createState("alpha\n\nbeta\n\ngamma", EditorSelection.create([range]));
      const plan = planBlockMove(state, readBlocks(state), 0, 3)!;
      expect(plan.selection.main.anchor).toBe(plan.movedFrom + range.anchor);
      expect(plan.selection.main.head).toBe(plan.movedFrom + range.head);
      expect(plan.changes.apply(state.doc).sliceString(plan.selection.main.from, plan.selection.main.to)).toBe("lph");
    }
  });

  it("maps all cursors and preserves the main range when order changes", () => {
    const state = createState("alpha\n\nbeta\n\ngamma", EditorSelection.create([
      EditorSelection.cursor(2), EditorSelection.cursor(8), EditorSelection.range(14, 17)
    ], 0));
    const plan = planBlockMove(state, readBlocks(state), 0, 3)!;
    expect(plan.selection.ranges.map(range => [range.anchor, range.head])).toEqual([[1, 1], [7, 10], [15, 15]]);
    expect(plan.selection.main.head).toBe(15);
  });

  it("maps the stationary content when a later block is inserted before it", () => {
    const state = createState("alpha\n\nbeta", EditorSelection.single(1, 4));
    const plan = planBlockMove(state, readBlocks(state), 1, 0)!;
    expect(plan.selection.main.anchor).toBe(7);
    expect(plan.selection.main.head).toBe(10);
  });

  it("keeps source-end and source-start cursors with the moved block", () => {
    const state = createState("alpha\n\nbeta", EditorSelection.create([
      EditorSelection.cursor(0), EditorSelection.cursor(5)
    ]));
    const plan = planBlockMove(state, readBlocks(state), 0, 2)!;
    expect(plan.selection.ranges.map(range => range.head)).toEqual([6, 11]);
  });

  it("keeps stationary boundary cursors attached to their content", () => {
    const atStart = createState("alpha\n\nbeta", EditorSelection.create([EditorSelection.cursor(0, -1)]));
    const prepend = planBlockMove(atStart, readBlocks(atStart), 1, 0)!;
    expect(prepend.selection.main.head).toBe(6);
    const atEnd = createState("alpha\n\nbeta", EditorSelection.single(11));
    const append = planBlockMove(atEnd, readBlocks(atEnd), 0, 2)!;
    expect(append.selection.main.head).toBe(4);
  });
});
