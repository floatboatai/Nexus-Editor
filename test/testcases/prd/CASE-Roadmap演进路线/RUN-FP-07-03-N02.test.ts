import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-N02: 多个 Widget 注册共存互不干扰", () => {
  it("步骤1-3: 两个 widget 并行渲染、标记对应、互不干扰", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text\n\n```js\nconst a = 1\n```\n\nInline `code` here",
      plugins: [
        {
          name: "multi-widget",
          widgets: [
            {
              nodeType: "code",
              render() {
                const el = document.createElement("div");
                el.setAttribute("data-widget", "code");
                return el;
              },
            },
            {
              nodeType: "inlineCode",
              block: false,
              render() {
                const el = document.createElement("span");
                el.setAttribute("data-widget", "inline");
                return el;
              },
            },
          ],
        },
      ],
    });
    // 光标移到文档末尾（离开所有 widget 源码范围）
    editor.setSelection(editor.getDocument().length);

    // 步骤1: [DOM] 两个 widget 同时存在
    expect(container.querySelector("[data-widget='code']")).not.toBeNull();
    expect(container.querySelector("[data-widget='inline']")).not.toBeNull();
    // 步骤2: [DOM] data-nexus-widget 分别对应 nodeType
    expect(container.querySelector("[data-widget='code']")?.getAttribute("data-nexus-widget")).toBe("code");
    expect(container.querySelector("[data-widget='inline']")?.getAttribute("data-nexus-widget")).toBe("inlineCode");
    // 步骤3: [STATE] 两个 widget 同时渲染，无相互替换
    expect(container.querySelectorAll("[data-widget]").length).toBe(2);

    editor.destroy();
  });
});
