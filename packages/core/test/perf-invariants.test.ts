/**
 * 作者：tobegold574（2026/9/17）
 * 原因：回归测试，钉住热路径各缓存所依赖的不变量。
 * 编辑器更新循环缓存了所有与 selection 无关的中间产物（live preview 区间、
 * widget 扩展 AST、wikilink 扫描、rebase 后的高亮 token）。一旦任何缓存对象
 * 不再是（文档, transform 状态）的纯函数——即光标位置泄漏进可复用的结果——
 * 下列测试必须失败。
 */
import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { createEditor, createWikilinksPlugin, type EditorAPI } from "../src/index";
import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { highlightCodeBlock } from "../src/live-preview-highlight";
import { collectLivePreviewRanges } from "../src/live-preview-ranges";
import type { WidgetDefinition } from "../src/types";

function parse(markdown: string): Root {
  return unified().use(remarkParse).parse(markdown) as Root;
}

describe("live preview range selection-independence", () => {
  // 作者：tobegold574（2026/9/17）
  // 原因：collectLivePreviewRanges 的结果会被编辑器缓存并在纯光标移动时复用，
  // 因此其输出必须与 selection 完全无关——这是缓存正确性的前提。
  it("returns identical ranges for any cursor position", () => {
    const doc = [
      "# Heading",
      "",
      "Text **bold** *italic* `code` [link](https://example.com)",
      "",
      "- list item",
      "",
      "> quote",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
      "![Alt](https://example.com/image.png)",
      "",
      "end",
    ].join("\n");

    const ast = lezerStringToMdast(doc);
    const baseline = collectLivePreviewRanges(ast, doc, []);
    expect(baseline.length).toBeGreaterThan(0);

    for (const at of [0, 3, 20, 45, doc.length]) {
      const withCursor = collectLivePreviewRanges(ast, doc, [EditorSelection.cursor(at)]);
      expect(withCursor).toEqual(baseline);
    }
  });
});

describe("live preview cursor toggling on a cached-range editor", () => {
  // 作者：tobegold574（2026/9/17）
  // 原因：完整跑两轮"光标进入/离开"，专门走复用缓存 (ast, codeTokens, ranges)
  // 的 selection-only 更新路径；每轮的显示/隐藏行为都必须与全新构建完全一致。
  it("toggles raw markers on enter and re-hides on leave, twice", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text **bold**\n\nend",
      livePreview: true,
    });

    const boldOffset = editor.getDocument().indexOf("**");
    for (let cycle = 0; cycle < 2; cycle++) {
      editor.setSelection(boldOffset);
      expect(container.textContent).toContain("**bold**");

      editor.setSelection(editor.getDocument().length);
      expect(container.textContent).not.toContain("**");
    }
    editor.destroy();
  });
});

describe("widget extension AST cache across cursor-only updates", () => {
  const widget: WidgetDefinition = {
    nodeType: "code",
    match: (node) => (node as { lang?: string | null }).lang === "wl",
    render: () => {
      const el = document.createElement("div");
      el.textContent = "WIDGET_RENDERED";
      return el;
    },
    block: true,
  };

  function widgetVisible(container: HTMLElement, editor: EditorAPI, visible: boolean): void {
    if (visible) {
      expect(container.textContent).toContain("WIDGET_RENDERED");
      expect(container.textContent).not.toContain("```");
    } else {
      // 作者：tobegold574（2026/9/17）
      // 原因：光标在块内 → 编辑态：显示原始源码，不渲染 widget。
      expect(container.textContent).toContain("```wl");
      expect(container.textContent).not.toContain("WIDGET_RENDERED");
    }
    void editor;
  }

  it("toggles widget visibility across repeated cursor moves", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "```wl\ncontent\n```\n\nafter",
      livePreview: false,
      plugins: [{ name: "bench-widget", widgets: [widget] }],
    });

    const inside = editor.getDocument().indexOf("content");
    editor.setSelection(inside);
    widgetVisible(container, editor, false);

    editor.setSelection(editor.getDocument().length);
    widgetVisible(container, editor, true);

    editor.setSelection(inside);
    widgetVisible(container, editor, false);

    editor.setSelection(editor.getDocument().length);
    widgetVisible(container, editor, true);
    editor.destroy();
  });
});

describe("wikilink scan cache across cursor-only updates", () => {
  it("keeps per-line marker hiding consistent across repeated cursor moves", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "See [[Note A]] here.\n\nsecond line [[Note B]]",
      livePreview: false,
      plugins: [createWikilinksPlugin()],
    });

    const line1 = editor.getDocument().indexOf("See");
    for (let cycle = 0; cycle < 2; cycle++) {
      editor.setSelection(line1);
      expect(container.textContent).toContain("[[Note A]]");
      expect(container.textContent).not.toContain("[[Note B]]");

      editor.setSelection(editor.getDocument().length);
      expect(container.textContent).not.toContain("[[Note A]]");
      expect(container.textContent).toContain("[[Note B]]");
    }
    editor.destroy();
  });
});

describe("transaction pipeline lazy document snapshots", () => {
  it("exposes documentBefore/documentAfter on the dispatch result", () => {
    const editor = createEditor({ container: document.createElement("div"), initialValue: "start" });

    const result = editor.dispatchTransaction({
      changes: [{ from: 0, to: 0, insert: "Hi " }],
      origin: ["test"],
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.update.documentBefore).toBe("start");
      expect(result.update.documentAfter).toBe("Hi start");
      expect(result.update.documentBefore).toBe("start");
    }
    editor.destroy();
  });
});

describe("highlight token rebased memo", () => {
  it("returns identical, instance-stable tokens for repeated contentStart reads", () => {
    const code = "const value = 42;";
    const first = highlightCodeBlock("js", code, 100);
    expect(first.length).toBeGreaterThan(0);

    const second = highlightCodeBlock("js", code, 100);
    expect(second).toBe(first);

    const shifted = highlightCodeBlock("js", code, 250);
    expect(shifted).not.toBe(first);
    expect(shifted.map((t) => ({ from: t.from - 150, to: t.to - 150, className: t.className })))
      .toEqual(first.map((t) => ({ from: t.from, to: t.to, className: t.className })));
  });
});
