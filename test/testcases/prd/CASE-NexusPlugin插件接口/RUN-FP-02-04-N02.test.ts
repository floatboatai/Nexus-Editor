import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-N02: exportHTML() 反映 remark 插件转换结果", () => {
  it("步骤1: HTML 包含 h1 与注入的 p", () => {
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

    // 步骤1: [API] exportHTML 包含 <h1>Heading</h1> 与 <p>plugin-injected</p>
    const html = editor.exportHTML();
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<p>plugin-injected</p>");

    editor.destroy();
  });
});
