import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-B01: 多个 remark 插件按注册顺序依次执行", () => {
  it("步骤1-2: children 类型与注入文本顺序正确", () => {
    const appendFirst: Plugin<[], Root, Root> = function () {
      return (tree) => {
        tree.children.push({
          type: "paragraph",
          children: [{ type: "text", value: "first" }],
        });
      };
    };
    const appendSecond: Plugin<[], Root, Root> = function () {
      return (tree) => {
        tree.children.push({
          type: "paragraph",
          children: [{ type: "text", value: "second" }],
        });
      };
    };

    const remarkPlugin: NexusPlugin = {
      name: "multi-remark",
      remarkPlugins: [appendFirst, appendSecond],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Heading",
      plugins: [remarkPlugin],
    });

    // 步骤1: [AST] children 长度 3，类型 ["heading", "paragraph", "paragraph"]
    const ast = editor.getAst();
    expect(ast.children.length).toBe(3);
    expect(ast.children.map((c) => c.type)).toEqual(["heading", "paragraph", "paragraph"]);
    // 步骤2: [AST] 注入文本顺序 ["first", "second"]
    const injected = ast.children
      .slice(1)
      .map((p) => (p as { children?: Array<{ value?: string }> }).children?.[0]?.value);
    expect(injected).toEqual(["first", "second"]);

    editor.destroy();
  });
});
