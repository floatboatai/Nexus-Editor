import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-D01: 多插件斜杠命令按注册顺序聚合", () => {
  it("步骤1-2: 命令顺序与注册顺序一致，菜单命令保持顺序", () => {
    const pluginA: NexusPlugin = {
      name: "plugin-a",
      slashCommands: [{ id: "cmd-a", title: "Alpha" }],
    };
    const pluginB: NexusPlugin = {
      name: "plugin-b",
      slashCommands: [{ id: "cmd-b", title: "Beta" }],
    };
    const pluginC: NexusPlugin = {
      name: "plugin-c",
      slashCommands: [{ id: "cmd-c", title: "Gamma" }],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n",
      plugins: [pluginA, pluginB, pluginC],
    });

    let lastState: SlashMenuState | null = null;
    editor.on("slashMenuChange", (state) => {
      lastState = state;
    });

    // 步骤1: [API] 命令顺序与注册顺序一致
    expect(editor.getSlashCommands().map((c) => c.id)).toEqual(["cmd-a", "cmd-b", "cmd-c"]);
    // 步骤2: [STATE] 行首输入 / 后菜单命令保持注册顺序（/ 需在行首，见 N02 修正说明）
    editor.setSelection(6);
    editor.replaceSelection("/");
    expect(lastState?.commands.map((c) => c.id)).toEqual(["cmd-a", "cmd-b", "cmd-c"]);

    editor.destroy();
  });
});
