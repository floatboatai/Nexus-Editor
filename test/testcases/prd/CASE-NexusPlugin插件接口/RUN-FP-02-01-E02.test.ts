import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-01-E02: 两个插件使用相同 name，扩展均生效（name 不参与去重）", () => {
  it("步骤1-3: 同名插件各自的快捷键均可触发", () => {
    const dupA: NexusPlugin = {
      name: "dup",
      shortcuts: [
        {
          key: "Ctrl-a",
          run(api) {
            api.setDocument("from-dup-a");
            return true;
          },
        },
      ],
    };
    const dupB: NexusPlugin = {
      name: "dup",
      shortcuts: [
        {
          key: "Ctrl-b",
          run(api) {
            api.setDocument("from-dup-b");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [dupA, dupB],
    });

    // 步骤1: dupA 快捷键生效
    expect(editor.runShortcut("Ctrl-a")).toBe(true);
    expect(editor.getDocument()).toBe("from-dup-a");
    // 步骤2: dupB 快捷键生效
    expect(editor.runShortcut("Ctrl-b")).toBe(true);
    expect(editor.getDocument()).toBe("from-dup-b");

    editor.destroy();
  });
});
