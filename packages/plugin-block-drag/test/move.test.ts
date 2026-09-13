import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { afterEach, describe, expect, it } from "vitest";
import { planBlockMove, readBlocks } from "../src/move";

const editors: ReturnType<typeof createEditor>[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function stateFor(source: string): EditorState {
  let captured!: EditorView;
  editors.push(createEditor({
    container: document.createElement("div"),
    initialValue: source,
    multiCursor: true,
    plugins: [{ name: "capture", cmExtensions: [ViewPlugin.define((view) => {
      captured = view;
      return {};
    })] }],
  }));
  return captured.state;
}

describe("Markdown block moves", () => {
  it("moves a paragraph to the end without losing text and carries its cursor", () => {
    let state = stateFor("Alpha\n\nBeta\n\nGamma");
    state = state.update({ selection: EditorSelection.cursor(2) }).state;
    const blocks = readBlocks(state);
    const move = planBlockMove(state, blocks, 0, 3)!;
    const next = state.update(move);
    expect(next.state.doc.toString()).toBe("Beta\n\nGamma\n\nAlpha");
    expect(next.state.selection.main.head).toBe(15);
  });

  it("refuses a move that would merge two independent lists at the source boundary", () => {
    const state = stateFor("- First\n\nSeparator\n\n- Second\n\nEnd");
    expect(planBlockMove(state, readBlocks(state), 1, 4)).toBeNull();
  });

  it.each([
    "- First\n- Second\n  - Child",
    "> Quote\n>\n> - Nested",
    "```ts\nconst x = 1;\n\nconsole.log(x);\n```",
    "    indented code\n    second line",
    "| A | B |\n| --- | --- |\n| 1 | 2 |",
    "![image](image.png)",
    "Text with ![image](image.png) inside.",
    "---",
  ])("moves an entire block unchanged: %s", (block) => {
    const state = stateFor(`Before\n\n${block}\n\nAfter\n`);
    const blocks = readBlocks(state);
    expect(blocks).toHaveLength(3);
    const move = planBlockMove(state, blocks, 1, 0)!;
    expect(move).not.toBeNull();
    expect(state.update(move).state.doc.toString()).toBe(`${block}\n\nBefore\n\nAfter\n`);
  });

  it("moves only the heading, leaving its paragraphs behind", () => {
    const state = stateFor("## Background\n\nFirst paragraph\n\nSecond paragraph\n\n## Conclusion");
    const move = planBlockMove(state, readBlocks(state), 0, 3)!;
    expect(state.update(move).state.doc.toString()).toBe("First paragraph\n\nSecond paragraph\n\n## Background\n\n## Conclusion");
  });

  it("preserves leading/trailing whitespace, opaque blocks, and unaffected separators", () => {
    const state = stateFor("\n\n[ref]: /example\n\nAlpha\n\nBeta\n\n\n```txt\n[ref]\n```\n\n");
    const move = planBlockMove(state, readBlocks(state), 1, 0)!;
    expect(state.update(move).state.doc.toString()).toBe("\n\nAlpha\n\n[ref]: /example\n\nBeta\n\n\n```txt\n[ref]\n```\n\n");
    expect(planBlockMove(state, readBlocks(state), 0, 4)).toBeNull();
  });

  it("keeps multiple selections attached to their original content", () => {
    let state = stateFor("Alpha\n\nBeta\n\nGamma");
    state = state.update({ selection: EditorSelection.create([
      EditorSelection.range(1, 4), EditorSelection.cursor(9), EditorSelection.range(16, 14),
    ], 1) }).state;
    const next = state.update(planBlockMove(state, readBlocks(state), 2, 0)!).state;
    expect(next.selection.ranges.map((range) => [range.anchor, range.head])).toEqual([[3, 1], [8, 11], [16, 16]]);
    expect(next.selection.main.head).toBe(16);
  });

  it("inserts necessary separation when relocating a heading beside a paragraph", () => {
    const state = stateFor("Alpha\n# Heading\nBeta");
    const next = state.update(planBlockMove(state, readBlocks(state), 1, 3)!).state;
    expect(next.doc.toString()).toBe("Alpha\n\nBeta\n\n# Heading");
  });

  it.each([0, 1])("treats gap %i beside the source as a no-op", (target) => {
    const state = stateFor("Alpha\n\nBeta");
    expect(planBlockMove(state, readBlocks(state), 0, target)).toBeNull();
  });

  it("moves CRLF input using the editor's normalized document coordinates", () => {
    const state = stateFor("Alpha\r\n\r\nBeta\r\n");
    const next = state.update(planBlockMove(state, readBlocks(state), 0, 2)!).state;
    expect(next.doc.toString()).toBe("Beta\n\nAlpha\n");
  });
});
