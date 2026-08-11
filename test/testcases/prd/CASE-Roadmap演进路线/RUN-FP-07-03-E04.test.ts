import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-E04: 非法 Widget 定义（nodeType 空串）不崩溃且无替换", () => {
  it("步骤1-3: 创建不抛错、无渲染、内容完整", () => {
    const container = document.createElement("div");
    // 步骤1: [STATE] 空 nodeType 创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "Text\n\n```js\nconsole.log(1)\n```",
        plugins: [
          {
            name: "bad-widget",
            widgets: [
              {
                nodeType: "",
                render() {
                  const el = document.createElement("div");
                  el.setAttribute("data-widget", "bad");
                  return el;
                },
              },
            ],
          },
        ],
      });
    }).not.toThrow();
    editor = editor!;
    // 步骤2: [DOM] 空串不匹配任何节点，无 widget
    expect(container.querySelector("[data-widget='bad']")).toBeNull();
    // 步骤3: [DOM] 内容完整
    expect(container.textContent).toContain("console.log(1)");

    editor.destroy();
  });
});
