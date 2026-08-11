import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-D01: remark 插件仅改变 AST，文档源码不变（round-trip 无损）", () => {
  it("步骤1-2: 源码保持原样，AST 含注入节点", () => {
    const appendParagraph: Plugin<[], Root, Root> = function () {
      return (tree) => {
        tree.children.push({
          type: "paragraph",
          children: [{ type: "text", value: "plugin-injected" }],
        });
      };
    };

    const remarkPlugin: NexusPlugin = {
      name: "remark-transform",
      remarkPlugins: [appendParagraph],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Heading",
      plugins: [remarkPlugin],
    });

    // 步骤1: [API] 源码不被转换写回
    expect(editor.getDocument()).toBe("# Heading");
    // 步骤2: [AST] AST 含注入节点
    expect(editor.getAst().children.map((c) => c.type)).toContain("paragraph");

    editor.destroy();
  });
});
