import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-E02: Widget nodeType 无匹配节点时静默不渲染", () => {
  it("步骤1-3: code widget 渲染、blockquote 源码保留、不抛错", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconsole.log(1)\n```\n\n> quote",
      plugins: [
        {
          name: "quote-widget",
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
    editor.setSelection(editor.getDocument().length);

    // 步骤1: [DOM] code widget 渲染
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    // 步骤2: [DOM] blockquote 未被误替换（无 blockquote widget 注册，源码保留）
    expect(container.textContent).toContain("> quote");
    // 步骤3: [STATE] 无匹配类型静默不报错（创建已成功即验证）

    editor.destroy();
  });
});
