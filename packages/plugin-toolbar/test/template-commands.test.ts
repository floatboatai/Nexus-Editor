import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI, type EditorConfig } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  createTemplateCommandsPlugin,
  createToolbarPlugin,
  insertInlineMath,
  insertMathBlock,
  insertMermaid,
  insertTable,
} from "../src/index";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(initialValue = "", config: Partial<EditorConfig> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({ container, initialValue, multiCursor: true, plugins: [createHistoryPlugin()], ...config });
  editors.push(editor);
  return editor;
}

const helpers = [
  ["table", insertTable],
  ["math block", insertMathBlock],
  ["inline math", insertInlineMath],
  ["Mermaid", insertMermaid],
] as const;

function selectedTexts(editor: EditorAPI): string[] {
  const source = editor.getDocument();
  return editor.getSelections().ranges.map(({ anchor, head }) => source.slice(Math.min(anchor, head), Math.max(anchor, head)));
}

describe("opt-in template commands", () => {
  it("adds only explicit named commands, without changing the default toolbar plugin", () => {
    const defaults = createToolbarPlugin();
    const plugin = createTemplateCommandsPlugin();
    expect(defaults.commands).toBeUndefined();
    expect(defaults.shortcuts?.map((item) => item.key)).toEqual(["Mod-b", "Mod-i", "Mod-Shift-s", "Mod-e", "Mod-k", "Mod-1", "Mod-2", "Mod-3"]);
    expect(plugin.shortcuts).toBeUndefined();
    expect(plugin.slashCommands).toBeUndefined();
    expect(plugin.cmExtensions).toBeUndefined();
    expect(plugin.commands?.map((command) => command.id)).toEqual([
      "template:insert-table", "template:insert-math-block", "template:insert-inline-math", "template:insert-mermaid",
    ]);
    const without = setup();
    expect(without.runCommand("template:insert-table")).toBe(false);
    const enabled = setup("", { plugins: [createHistoryPlugin(), plugin] });
    expect(enabled.runCommand("template:insert-inline-math")).toBe(true);
    expect(enabled.getDocument()).toBe("$x$");
  });

  it.each([
    [insertTable, "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |", "Column 1"],
    [insertMathBlock, "$$\nE = mc^2\n$$", "E = mc^2"],
    [insertInlineMath, "$x$", "x"],
    [insertMermaid, "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```", "flowchart TD\n  A[Start] --> B[End]"],
  ] as const)("inserts an empty-selection template and selects its placeholder", (insert, markdown, placeholder) => {
    const editor = setup();
    expect(insert(editor)).toBe(true);
    expect(editor.getDocument()).toBe(markdown);
    expect(selectedTexts(editor)).toEqual([placeholder]);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    expect(editor.undo()).toBe(false);
  });

  it.each(helpers)("atomically inserts %s at all source selections and preserves mainIndex", (_name, insert) => {
    const editor = setup("one middle two");
    editor.setSelections([{ anchor: 3, head: 0 }, { anchor: 11, head: 14 }], 0);
    const originalSelections = editor.getSelections();
    const dispatch = vi.spyOn(editor, "dispatchTransaction");
    expect(insert(editor)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ history: "isolate", selection: { mainIndex: 0 } });
    expect(dispatch.mock.calls[0][0].changes).toHaveLength(2);
    expect(editor.getSelections().mainIndex).toBe(0);
    expect(selectedTexts(editor)).toEqual(["one", "two"]);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one middle two");
    expect(editor.getSelections()).toEqual(originalSelections);
  });

  it("keeps a secondary collapsed cursor as the main selection", () => {
    const editor = setup("A B");
    editor.setSelections([{ anchor: 0 }, { anchor: 3 }], 1);
    expect(insertInlineMath(editor)).toBe(true);
    expect(editor.getDocument()).toBe("$x$A B$x$");
    expect(editor.getSelections()).toEqual({ ranges: [{ anchor: 1, head: 2 }, { anchor: 7, head: 8 }], mainIndex: 1 });
  });

  it.each(helpers)("isolates %s insertion from preceding and subsequent typing", (_name, insert) => {
    const editor = setup("start");
    editor.dispatchTransaction({ changes: [{ from: 5, to: 5, insert: " typed" }], origin: ["test-typing"], userEvent: "input.type" });
    const beforeTemplate = editor.getDocument();
    editor.setSelection(beforeTemplate.length);
    expect(insert(editor)).toBe(true);
    const withTemplate = editor.getDocument();
    const selection = editor.getSelection();
    editor.dispatchTransaction({
      changes: [{ from: selection.anchor, to: selection.head, insert: "replacement" }],
      origin: ["test-typing"], userEvent: "input.type",
    });
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(withTemplate);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(beforeTemplate);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
  });

  it("escapes table pipes, preceding backslashes and selected newlines", () => {
    const editor = setup("a\\|b\nc");
    editor.setSelection(0, editor.getDocument().length);
    expect(insertTable(editor)).toBe(true);
    const escaped = "a" + "\\".repeat(3) + "|b<br>c";
    expect(editor.getDocument()).toBe(`| ${escaped} | Column 2 |\n| --- | --- |\n| Cell | Cell |`);
    expect(selectedTexts(editor)).toEqual([escaped]);
  });

  it.each([
    ["beforeafter", 6, "before\n\n$$\nE = mc^2\n$$\n\nafter"],
    ["before\nafter", 7, "before\n\n$$\nE = mc^2\n$$\n\nafter"],
    ["before\n\nafter", 8, "before\n\n$$\nE = mc^2\n$$\n\nafter"],
  ] as const)("adds only the missing block separators", (source, position, expected) => {
    const editor = setup(source);
    editor.setSelection(position);
    expect(insertMathBlock(editor)).toBe(true);
    expect(editor.getDocument()).toBe(expected);
  });

  it("uses one blank separator between adjacent replacement blocks", () => {
    const editor = setup("AB");
    vi.spyOn(editor, "getSelections").mockReturnValue({ ranges: [{ anchor: 0, head: 1 }, { anchor: 1, head: 2 }], mainIndex: 1 });
    expect(insertMathBlock(editor)).toBe(true);
    expect(editor.getDocument()).toBe("$$\nA\n$$\n\n$$\nB\n$$");
  });

  it("uses a longer Mermaid fence and selects content, not the language label", () => {
    const content = "mermaid\n```\n`````\nend";
    const editor = setup(content);
    editor.setSelection(0, content.length);
    expect(insertMermaid(editor)).toBe(true);
    expect(editor.getDocument()).toBe("``````mermaid\n" + content + "\n``````");
    expect(selectedTexts(editor)).toEqual([content]);
  });

  it.each(helpers)("rejects %s while readonly, composing, or interacting without mutation", (_name, insert) => {
    const readonly = setup("read only", { readOnly: true });
    const readonlyDispatch = vi.spyOn(readonly, "dispatchTransaction");
    expect(insert(readonly)).toBe(false);
    expect(readonlyDispatch).not.toHaveBeenCalled();
    const editor = setup("untouched");
    const dispatch = vi.spyOn(editor, "dispatchTransaction");
    const composing = vi.spyOn(editor, "isComposing").mockReturnValue(true);
    expect(insert(editor)).toBe(false);
    composing.mockRestore();
    vi.spyOn(editor.getContributionSink(), "isInteractionActive").mockReturnValue(true);
    expect(insert(editor)).toBe(false);
    expect(editor.getDocument()).toBe("untouched");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed for old editors without a readonly query", () => {
    const source = setup("unchanged");
    const dispatch = vi.spyOn(source, "dispatchTransaction");
    const oldEditor: EditorAPI = { ...source, isReadOnly: undefined };
    for (const [, insert] of helpers) expect(insert(oldEditor)).toBe(false);
    expect(source.getDocument()).toBe("unchanged");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not redirect editing to the DOM-focused editor", () => {
    const source = setup("source"), focused = setup("other");
    source.setSelection(0, 6);
    focused.focus();
    expect(insertInlineMath(source)).toBe(true);
    expect(source.getDocument()).toBe("$source$");
    expect(focused.getDocument()).toBe("other");
  });

  it("returns false without focusing when a transaction filter rejects insertion", async () => {
    const editor = setup("untouched");
    const registration = editor.getContributionSink().registerTransactionFilter("template-test", () => ({ action: "reject", reason: "test-policy" }));
    await registration.ready;
    const focus = vi.spyOn(editor, "focus");
    expect(insertTable(editor)).toBe(false);
    expect(editor.getDocument()).toBe("untouched");
    expect(focus).not.toHaveBeenCalled();
    await registration.dispose();
  });

  it("rejects invalid or overlapping source selections before dispatch", () => {
    const editor = setup("abc");
    const selections = vi.spyOn(editor, "getSelections");
    const dispatch = vi.spyOn(editor, "dispatchTransaction");
    for (const ranges of [[], [{ anchor: -1, head: 1 }], [{ anchor: 0, head: 4 }], [{ anchor: 0, head: 2 }, { anchor: 1, head: 3 }]]) {
      selections.mockReturnValue({ ranges, mainIndex: 0 });
      expect(insertTable(editor)).toBe(false);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});
