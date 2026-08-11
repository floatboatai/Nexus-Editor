import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-E01: 调用未注册的 key，runShortcut 返回 false", () => {
  it("步骤1-2: 未注册 key 与空 key 均返回 false", () => {
    const shortcutPlugin: NexusPlugin = {
      name: "shortcut-plugin",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [shortcutPlugin],
    });

    // 步骤1: [API] 未注册 key 返回 false
    expect(editor.runShortcut("Mod-x")).toBe(false);
    // 步骤2: [API] 空 key 返回 false
    expect(editor.runShortcut("")).toBe(false);

    editor.destroy();
  });
});
