import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-N01: remark transform 插件修改 getAst() 输出的 AST", () => {
  it("步骤1-2: children 含 heading+paragraph，注入节点内容正确", () => {
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

    // 步骤1: [AST] children 类型 ["heading", "paragraph"]
    const ast = editor.getAst();
    expect(ast.children.map((c) => c.type)).toEqual(["heading", "paragraph"]);
    // 步骤2: [AST] 注入节点文本
    const injected = ast.children[1] as { children?: Array<{ value?: string }> };
    expect(injected.children?.[0]?.value).toBe("plugin-injected");

    editor.destroy();
  });
});
