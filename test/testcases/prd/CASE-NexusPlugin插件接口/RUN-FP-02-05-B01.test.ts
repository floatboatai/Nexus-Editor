import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-B01: 无匹配节点的文档不渲染任何 widget", () => {
  it("步骤1-2: 无 widget 渲染，文档内容完整", () => {
    const widgetPlugin: NexusPlugin = {
      name: "code-widget",
      widgets: [
        {
          nodeType: "code",
          render() {
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
      initialValue: "Just a paragraph without code blocks",
      plugins: [widgetPlugin],
    });

    // 步骤1: [DOM] 无匹配节点不渲染
    expect(container.querySelector("[data-widget='code']")).toBeNull();
    // 步骤2: [DOM] 原生渲染不受影响
    expect(container.textContent).toContain("Just a paragraph");

    editor.destroy();
  });
});
