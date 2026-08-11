import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-B02: ignoreEvents:true 时宿主交互事件仍可响应", () => {
  it("步骤1-3: widget 渲染、点击计数、选区不变", () => {
    const container = document.createElement("div");
    let clicks = 0;
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [
        {
          name: "interactive-widget",
          widgets: [
            {
              nodeType: "code",
              ignoreEvents: true,
              render() {
                const el = document.createElement("button");
                el.setAttribute("data-widget", "interactive");
                el.addEventListener("click", () => {
                  clicks += 1;
                });
                return el;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: [DOM] widget 渲染
    const btn = container.querySelector("[data-widget='interactive']") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // 步骤2: [EVENT] 记录初始选区，dispatch click
    const before = editor.getSelection().anchor;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1);
    // 步骤3: [STATE] 选区未被 widget 内事件移动
    expect(editor.getSelection().anchor).toBe(before);

    editor.destroy();
  });
});
