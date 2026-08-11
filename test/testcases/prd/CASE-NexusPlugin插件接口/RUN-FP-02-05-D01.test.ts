import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-D01: render 收到的 source 参数与文档源码片段一致", () => {
  it("步骤1-2: source 为完整围栏源码，node 为 mdast 节点", () => {
    let capturedSource: string | null = null;
    let capturedNode: { type?: string; lang?: string } | null = null;
    const widgetPlugin: NexusPlugin = {
      name: "code-widget",
      widgets: [
        {
          nodeType: "code",
          render(node: any, source: string) {
            capturedNode = node;
            capturedSource = source;
            const el = document.createElement("div");
            el.setAttribute("data-widget", "code");
            return el;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [widgetPlugin],
    });

    // 步骤1: [数据] source 含 ``` 围栏的完整源码片段
    expect(capturedSource).toBe("```js\nconsole.log(1)\n```");
    // 步骤2: [AST] node 为 mdast code 节点
    expect(capturedNode?.type).toBe("code");
    expect(capturedNode?.lang).toBe("js");

    editor.destroy();
  });
});
