import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-F01: Widget destroy 回调随 widget 移除触发", () => {
  it("步骤1-3: 渲染、光标进入触发 destroy、编辑器销毁不抛错", () => {
    const destroyFn = vi.fn();
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
              destroy: destroyFn,
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

    // 步骤1: [DOM] widget 已渲染
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    // 步骤2: [EVENT] 光标进入源码范围，widget 移除触发 destroy
    editor.setSelection(10);
    expect(destroyFn.mock.calls.length).toBeGreaterThanOrEqual(1);
    // 步骤3: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
  });
});
