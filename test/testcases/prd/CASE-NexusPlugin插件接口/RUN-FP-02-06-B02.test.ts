import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { EditorView } from "@codemirror/view";

describe("FP-02-06-B02: 多个插件的 cmExtensions 合并生效（不覆盖）", () => {
  it("步骤1-2: 两个属性均生效，文档正常", () => {
    const pluginOne: NexusPlugin = {
      name: "attrs-one",
      cmExtensions: [EditorView.editorAttributes.of({ "data-one": "1" })],
    };
    const pluginTwo: NexusPlugin = {
      name: "attrs-two",
      cmExtensions: [EditorView.editorAttributes.of({ "data-two": "2" })],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [pluginOne, pluginTwo],
    });

    // 步骤1: [DOM] 两个属性均生效
    expect(container.querySelector(".cm-editor")?.getAttribute("data-one")).toBe("1");
    expect(container.querySelector(".cm-editor")?.getAttribute("data-two")).toBe("2");
    // 步骤2: [API] 文档正常
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
