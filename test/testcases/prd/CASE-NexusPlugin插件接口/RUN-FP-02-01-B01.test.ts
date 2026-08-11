import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-01-B01: 超长 name（1024 字符）不影响编辑器创建", () => {
  it("步骤1-3: 创建不抛错、扩展生效、文档正确", () => {
    const longName = "x".repeat(1024);
    const longNamePlugin: NexusPlugin = {
      name: longName,
      shortcuts: [
        {
          key: "Mod-b",
          run() {
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    // 步骤1: [STATE] createEditor 不抛出异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "# Hello",
        plugins: [longNamePlugin],
      });
    }).not.toThrow();
    editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [longNamePlugin],
    });
    // 步骤2: [API] 扩展仍生效
    expect(editor.runShortcut("Mod-b")).toBe(true);
    // 步骤3: [API] 文档内容
    expect(editor.getDocument()).toBe("# Hello");

    editor.destroy();
  });
});
