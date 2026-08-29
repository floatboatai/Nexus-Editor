import { describe, expect, it } from "vitest";
import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";
import {
  applyListItemReorder,
  dropIndexAfterRemoval,
  normalizeSiblingSpans,
  reorderSiblingListItems
} from "../src/live-preview-list";

function spansFromEditor(editor: ReturnType<typeof createEditor>, listIndex = 0) {
  const lists: Array<{ children: Array<{ position?: { start: { offset?: number }; end: { offset?: number } } }> }> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; children?: unknown[] };
    if (node.type === "list") lists.push(node as (typeof lists)[number]);
    for (const c of node.children ?? []) walk(c);
  };
  walk(editor.getAst());
  const list = lists[listIndex];
  if (!list) throw new Error(`list ${listIndex} not found`);
  return list.children.map((item) => ({
    from: item.position!.start.offset!,
    to: item.position!.end.offset!
  }));
}

describe("list drag audit / edge cases", () => {
  it("ordered reorder renumbers with real AST spans", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "1. a\n2. b\n3. c\n",
      livePreview: true,
      plugins: [createGfmPreset()]
    });
    const items = spansFromEditor(editor);
    const next = applyListItemReorder(editor.getDocument(), items, 2, 0, {
      ordered: true,
      startNum: 1
    });
    expect(next).toBe("1. c\n2. a\n3. b\n");
    editor.destroy();
  });

  it("renumbers when marker digit width changes (9 → 10)", () => {
    const doc = "8. a\n9. b\n10. c\n";
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: doc,
      livePreview: true,
      plugins: [createGfmPreset()]
    });
    const items = spansFromEditor(editor);
    const next = applyListItemReorder(doc, items, 2, 0, {
      ordered: true,
      startNum: 8
    });
    expect(next).toBe("8. c\n9. a\n10. b\n");
    editor.destroy();
  });

  it("loose list blank lines do not glue items together", () => {
    const doc = "- a\n\n- b\n\n- c\n";
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: doc,
      livePreview: true,
      plugins: [createGfmPreset()]
    });
    const items = spansFromEditor(editor);
    const norm = normalizeSiblingSpans(doc, items);
    const region = doc.slice(norm[0].from, norm[norm.length - 1].to);
    const rebuilt = norm
      .map((s, i) => doc.slice(s.from, i < norm.length - 1 ? norm[i + 1].from : s.to))
      .join("");
    expect(rebuilt).toBe(region);

    const toIndex = dropIndexAfterRemoval(0, 1, true);
    const next = reorderSiblingListItems(doc, items, 0, toIndex);
    expect(next).not.toMatch(/- b-/);
    expect(next.indexOf("- b")).toBeLessThan(next.indexOf("- a"));
    editor.destroy();
  });

  it("reorders siblings inside a nested list", () => {
    const doc = "- parent\n  - x\n  - y\n  - z\n- other\n";
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: doc,
      livePreview: true,
      plugins: [createGfmPreset()]
    });
    const items = spansFromEditor(editor, 1);
    expect(items.length).toBe(3);
    const toIndex = dropIndexAfterRemoval(0, 2, true);
    const next = applyListItemReorder(doc, items, 0, toIndex);
    expect(next).toBe("- parent\n  - y\n  - z\n  - x\n- other\n");
    editor.destroy();
  });

  it("ranged replace preserves surrounding text better than full doc swap semantics", () => {
    const doc = "intro\n\n- a\n- b\n- c\n\noutro\n";
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: doc,
      livePreview: true,
      plugins: [createGfmPreset()]
    });
    const items = spansFromEditor(editor);
    const next = applyListItemReorder(doc, items, 0, 1)!;
    expect(next.startsWith("intro\n\n")).toBe(true);
    expect(next.endsWith("\noutro\n") || next.endsWith("outro\n")).toBe(true);
    editor.destroy();
  });
});
