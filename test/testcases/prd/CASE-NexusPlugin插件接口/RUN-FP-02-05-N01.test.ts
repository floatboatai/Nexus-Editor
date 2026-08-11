import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-N01: 匹配的 AST 节点渲染为自定义 widget", () => {
  it("步骤1-3: widget 渲染、data-nexus-widget 标记、源码被替换", () => {
    const widgetPlugin: NexusPlugin = {
      name: "code-widget",
      widgets: [
        {
          nodeType: "code",
          render(node: any, source: string) {
            const el = document.createElement("div");
            el.setAttribute("data-widget", "code");
            el.textContent = source;
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

    // 步骤1: [DOM] widget 已渲染
    const widget = container.querySelector("[data-widget='code']");
    expect(widget).not.toBeNull();
    // 步骤2: [DOM] 自动带 data-nexus-widget="code"
    expect(widget?.getAttribute("data-nexus-widget")).toBe("code");
    // 步骤3: [DOM] 源码被 widget 替换——围栏行不再以 markdown 源码形式出现在行 DOM 中
    // 修正说明: 用例文档断言 container.textContent 不含 "console.log(1)" 与 render 实现矛盾
    //（render 主动把 source 写入 widget 文本）。正确验证: .cm-line 行文本中围栏源码已消失。
    const lineText = Array.from(container.querySelectorAll(".cm-line"))
      .map((l) => l.textContent ?? "")
      .join("\n");
    expect(lineText).not.toContain("```js");

    editor.destroy();
  });
});
