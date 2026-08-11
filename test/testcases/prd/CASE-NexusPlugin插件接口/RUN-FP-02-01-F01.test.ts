import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-01-F01: 插件注册→扩展生效→destroy 完整生命周期", () => {
  it("步骤1-4: 扩展生效、destroy 不抛错、destroy 后短路、DOM 清理", () => {
    const lifecyclePlugin: NexusPlugin = {
      name: "lifecycle",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            return true;
          },
        },
      ],
      slashCommands: [{ id: "cmd-1", title: "Command One" }],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [lifecyclePlugin],
    });

    // 步骤1: [API] 扩展全部生效
    expect(editor.getSlashCommands().map((c) => c.id)).toContain("cmd-1");
    expect(editor.runShortcut("Ctrl-k")).toBe(true);
    // 步骤2: [STATE] destroy 不抛出异常
    expect(() => editor.destroy()).not.toThrow();
    // 步骤3: [API] destroy 后 runShortcut 短路返回 false
    expect(editor.runShortcut("Ctrl-k")).toBe(false);
    // 步骤4: [DOM] DOM 已清理
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
