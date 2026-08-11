import { describe, expect, it } from "vitest";
import { createEditor, type WidgetRenderContext } from "@floatboat/nexus-core";

describe("FP-07-03-N03: Widget 交互流程：ctx.setSelection/focus 将光标带回源码编辑态", () => {
  it("步骤1-3: widget 渲染、点击后选区进入源码范围、源码可见", () => {
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
              render(_node, _source, ctx?: WidgetRenderContext) {
                const el = document.createElement("button");
                el.setAttribute("data-edit", "true");
                el.addEventListener("click", () => {
                  if (ctx) {
                    ctx.setSelection(ctx.from, ctx.from + 1);
                    ctx.focus();
                  }
                });
                return el;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: [DOM] widget 已渲染
    const btn = container.querySelector("[data-edit='true']") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // 步骤2: [EVENT] 点击后选区 anchor 进入 widget 源码范围
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const sel = editor.getSelection();
    expect(sel.anchor).toBeGreaterThanOrEqual(6);
    expect(sel.anchor).toBeLessThan(33);
    // 步骤3: [DOM] 光标进入范围后 widget 消失、源码可见
    expect(container.querySelector("[data-edit='true']")).toBeNull();
    expect(container.textContent).toContain("```js");

    editor.destroy();
  });
});
