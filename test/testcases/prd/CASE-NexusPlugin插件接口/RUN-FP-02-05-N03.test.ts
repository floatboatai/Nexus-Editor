import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-N03: match 谓词精确筛选被渲染的节点", () => {
  it("步骤1-2: mermaid 块 widget 化，js 块保持源码", () => {
    const widgetPlugin: NexusPlugin = {
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
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```mermaid\ngraph LR\n```\n\n```js\nconsole.log(1)\n```",
      plugins: [widgetPlugin],
    });

    // 步骤1: [DOM] mermaid widget 渲染
    expect(container.querySelector("[data-widget='mermaid']")).not.toBeNull();
    // 步骤2: [DOM] js 代码块未被 widget 化，保持源码
    expect(container.textContent).toContain("console.log(1)");

    editor.destroy();
  });
});
