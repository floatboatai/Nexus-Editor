import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-N01: runShortcut 精确执行注册的快捷键并返回 true", () => {
  it("步骤1-2: 返回 true，且初始光标 offset 0 导致文档开头插入", () => {
    let shortcutRan = false;
    const shortcutPlugin: NexusPlugin = {
      name: "shortcut-plugin",
      shortcuts: [
        {
          key: "Ctrl-k",
          run(api) {
            shortcutRan = true;
            api.replaceSelection("triggered");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [shortcutPlugin],
    });

    // 步骤1: [API] 返回 true
    expect(editor.runShortcut("Ctrl-k")).toBe(true);
    // 步骤2: [STATE] 回调执行；初始光标 offset 0，插入到文档开头
    expect(shortcutRan).toBe(true);
    expect(editor.getDocument()).toBe("triggeredhello world");

    editor.destroy();
  });
});
