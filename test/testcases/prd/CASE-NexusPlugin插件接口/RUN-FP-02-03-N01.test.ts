import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashCommandDef, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-N01: getSlashCommands 返回插件注册的斜杠命令", () => {
  it("步骤1-2: 返回完整命令对象（含 id/title/keywords/run）", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [
        {
          id: "heading-1",
          title: "Heading 1",
          keywords: ["h1", "title"],
          run() {
            return true;
          },
        },
        {
          id: "table",
          title: "Table",
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Heading",
      plugins: [slashPlugin],
    });

    // 步骤1: [API] 长度 2，按注册顺序
    const cmds: SlashCommandDef[] = editor.getSlashCommands();
    expect(cmds.length).toBe(2);
    expect(cmds.map((c) => c.id)).toEqual(["heading-1", "table"]);
    // 步骤2: [API] 字段完整；无 run 的命令保留为元数据
    expect(cmds[0]?.title).toBe("Heading 1");
    expect(cmds[0]?.keywords).toContain("h1");
    expect(typeof cmds[0]?.run).toBe("function");
    expect(typeof cmds[1]?.run).toBe("undefined");

    editor.destroy();
  });
});
