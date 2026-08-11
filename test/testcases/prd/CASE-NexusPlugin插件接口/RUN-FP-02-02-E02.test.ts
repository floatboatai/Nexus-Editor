import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-E02: 快捷键 run 回调抛出异常时异常向外传播", () => {
  it("步骤1-2: runShortcut 抛出异常，编辑器状态未被破坏", () => {
    const throwingPlugin: NexusPlugin = {
      name: "throwing-shortcut",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            throw new Error("TEST_shortcut_broken");
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [throwingPlugin],
    });

    // 步骤1: [STATE] 异常向外传播
    expect(() => editor.runShortcut("Ctrl-k")).toThrow("TEST_shortcut_broken");
    // 步骤2: [API] 编辑器状态未被破坏
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
