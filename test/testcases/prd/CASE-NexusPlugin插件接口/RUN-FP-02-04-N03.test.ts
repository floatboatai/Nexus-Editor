import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-N03: setDocument 后 AST 仍经过 remark 转换（增量生效）", () => {
  it("步骤1-2: 文档替换后 getAst 仍含注入节点", () => {
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
      initialValue: "first",
      plugins: [remarkPlugin],
    });

    // 步骤1: [API] 替换文档
    editor.setDocument("# Second");
    expect(editor.getDocument()).toBe("# Second");
    // 步骤2: [AST] 转换不是一次性，每次解析都应用
    const ast = editor.getAst();
    expect(ast.children.map((c) => c.type)).toEqual(["heading", "paragraph"]);

    editor.destroy();
  });
});
