import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-E01: widget 移除时调用 destroy 回调", () => {
  it("步骤1-3: 渲染时未调用，光标移入块内后触发 destroy", () => {
    const destroyFn = vi.fn();
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
          destroy: destroyFn,
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\ncode\n```",
      plugins: [widgetPlugin],
    });

    // 步骤1: [DOM] widget 渲染且 destroy 未调用
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    expect(destroyFn).not.toHaveBeenCalled();
    // 步骤2: 光标移入 code 块内
    editor.setSelection(10);
    // 步骤3: [EVENT] destroy 回调被调用
    expect(destroyFn).toHaveBeenCalled();

    editor.destroy();
  });
});
