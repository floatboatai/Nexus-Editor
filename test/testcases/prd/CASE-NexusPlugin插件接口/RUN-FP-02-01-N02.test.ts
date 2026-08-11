import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-01-N02: 多插件多 name 同时注册，扩展聚合生效", () => {
  it("步骤1-3: 命令聚合、快捷键执行、互不干扰", () => {
    const pluginA: NexusPlugin = {
      name: "plugin-a",
      shortcuts: [
        {
          key: "Ctrl-k",
          run(api) {
            api.setDocument("shortcut-ran");
            return true;
          },
        },
      ],
    };
    const pluginB: NexusPlugin = {
      name: "plugin-b",
      slashCommands: [{ id: "heading", title: "Heading" }],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [pluginA, pluginB],
    });

    // 步骤1: [API] getSlashCommands() 含 pluginB 的命令
    const ids = editor.getSlashCommands().map((c) => c.id);
    expect(ids).toContain("heading");
    // 步骤2: [API] runShortcut("Ctrl-k") === true，文档变为 "shortcut-ran"
    expect(editor.runShortcut("Ctrl-k")).toBe(true);
    expect(editor.getDocument()).toBe("shortcut-ran");
    // 步骤3: [API] 互不干扰
    expect(editor.getSlashCommands().length).toBe(1);

    editor.destroy();
  });
});
