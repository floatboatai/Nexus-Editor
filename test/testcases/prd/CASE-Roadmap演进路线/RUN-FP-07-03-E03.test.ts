import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-E03: match 谓词精细过滤：仅替换符合条件的节点", () => {
  it("步骤1-2: mermaid 被替换、js 保持源码", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "mermaid-widget",
          widgets: [
            {
              nodeType: "code",
              match: (node: any) => node.lang === "mermaid",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "mermaid");
                return el;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: [DOM] mermaid 命中渲染
    expect(container.querySelector("[data-widget='mermaid']")).not.toBeNull();
    // 步骤2: [DOM] js 未命中保持源码
    expect(container.textContent).toContain("console.log(1)");

    editor.destroy();
  });
});
