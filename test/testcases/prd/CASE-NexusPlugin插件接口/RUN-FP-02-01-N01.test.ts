import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-01-N01: 注册单个命名插件，编辑器正常创建并渲染", () => {
  it("步骤1-4: 挂载、文档、快捷键、销毁", () => {
    let ran = false;
    const helloPlugin: NexusPlugin = {
      name: "hello-plugin",
      shortcuts: [
        {
          key: "Mod-b",
          run() {
            ran = true;
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [helloPlugin],
    });

    // 步骤1: [DOM] .cm-editor 不为 null
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: [API] getDocument() === "# Hello"
    expect(editor.getDocument()).toBe("# Hello");
    // 步骤3: [API] runShortcut("Mod-b") === true 且 ran === true
    expect(editor.runShortcut("Mod-b")).toBe(true);
    expect(ran).toBe(true);
    // 步骤4: [DOM] destroy 后移除
    editor.destroy();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
