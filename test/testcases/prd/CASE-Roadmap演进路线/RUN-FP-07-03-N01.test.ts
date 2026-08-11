import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-N01: 自定义 Widget 渲染并自动打上 data-nexus-widget 标记", () => {
  it("步骤1-4: 渲染、框架标记、内容、销毁", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "code-widget",
          widgets: [
            {
              nodeType: "code",
              render(_node, source) {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                el.textContent = source;
                return el;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: [DOM] widget 已渲染
    const widget = container.querySelector("[data-widget='code']");
    expect(widget).not.toBeNull();
    // 步骤2: [DOM] 框架自动附加 data-nexus-widget === "code"
    expect(widget?.getAttribute("data-nexus-widget")).toBe("code");
    // 步骤3: [DOM] textContent 为源码切片（含 console.log(1)）
    expect(widget?.textContent).toContain("console.log(1)");
    // 步骤4: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
  });
});
