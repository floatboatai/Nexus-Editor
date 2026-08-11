import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-03-B01: block:false 行内 Widget 不占独立行", () => {
  it("步骤1-2: 行内 widget 渲染、前后文本同保留在同一行", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "Text `code` end\n\nend",
      plugins: [
        {
          name: "inline-widget",
          widgets: [
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
    editor.setSelection(editor.getDocument().length);

    // 步骤1: [DOM] 行内 widget 渲染
    const widget = container.querySelector("[data-widget='inline']");
    expect(widget).not.toBeNull();
    // 步骤2: [DOM] 同行前后文本保留：widget 所在行应同时含 "Text " 与 " end"
    const widgetLine = widget?.closest(".cm-line");
    const lineText = widgetLine?.textContent ?? "";
    expect(lineText).toContain("Text ");
    expect(lineText).toContain(" end");

    editor.destroy();
  });
});
