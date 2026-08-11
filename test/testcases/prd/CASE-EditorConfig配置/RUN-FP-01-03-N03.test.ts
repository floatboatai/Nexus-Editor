import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { EditorView } from "@codemirror/view";

describe("FP-01-03-N03: 插件 cmExtensions 注入生效", () => {
  it("步骤1-2: .cm-editor 根节点带 data-plugin 属性、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "attrs",
          cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })],
        },
      ],
    });

    // 步骤1: 根节点属性
    expect(container.querySelector(".cm-editor")?.getAttribute("data-plugin")).toBe("yes");
    // 步骤2: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
