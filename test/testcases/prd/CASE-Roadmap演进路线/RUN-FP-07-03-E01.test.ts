import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-E01: 光标进入 Widget 源码范围时回退原始 markdown", () => {
  it("步骤1-3: 渲染、光标进入后消失、源码还原", () => {
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
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: [DOM] 初始（光标在头部，不相交）widget 渲染
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    // 步骤2: [DOM] 光标进入代码块范围后 widget 消失
    editor.setSelection(10);
    expect(container.querySelector("[data-widget='code']")).toBeNull();
    // 步骤3: [DOM] 源码还原
    expect(container.textContent).toContain("```js");

    editor.destroy();
  });
});
