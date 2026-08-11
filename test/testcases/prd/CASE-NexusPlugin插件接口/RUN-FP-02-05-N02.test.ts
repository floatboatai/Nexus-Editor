import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-05-N02: 光标进入 widget 范围时恢复源码", () => {
  it("步骤1-3: widget 渲染、光标移入块内 widget 移除且源码恢复", () => {
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
      initialValue: "Text\n\n```js\nconsole.log(1)\n```",
      plugins: [widgetPlugin],
    });

    // 步骤1: [DOM] widget 已渲染（初始光标在 Text 内，不与 code 相交）
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    // 步骤2: 光标移到 code 块内部（"Text\n\n" 为 7 字符，10 落在块内）
    editor.setSelection(10);
    // 步骤3: [DOM] widget 移除、源码恢复
    expect(container.querySelector("[data-widget='code']")).toBeNull();
    expect(container.textContent).toContain("```js");

    editor.destroy();
  });
});
