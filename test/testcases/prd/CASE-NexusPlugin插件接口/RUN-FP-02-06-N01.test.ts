import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { EditorView } from "@codemirror/view";

describe("FP-02-06-N01: cmExtensions 中 editorAttributes 注入编辑器根节点", () => {
  it("步骤1-2: data-plugin 属性生效，文档可读", () => {
    const attrsPlugin: NexusPlugin = {
      name: "attrs-plugin",
      cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [attrsPlugin],
    });

    // 步骤1: [DOM] 根节点属性
    expect(container.querySelector(".cm-editor")?.getAttribute("data-plugin")).toBe("yes");
    // 步骤2: [API] 文档可读
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
