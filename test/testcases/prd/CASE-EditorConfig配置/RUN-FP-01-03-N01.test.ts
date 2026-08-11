import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { SlashCommandDef } from "@floatboat/nexus-core";

describe("FP-01-03-N01: 插件 slashCommands 注册后可通过 API 获取", () => {
  it("步骤1-3: getSlashCommands 含 heading、元数据透传、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "demo",
          slashCommands: [{ id: "heading", title: "Heading", keywords: ["h1"] }],
        },
      ],
    });

    // 步骤1: 命令 id 包含 heading
    const cmds = editor.getSlashCommands();
    expect(cmds.some((c) => c.id === "heading")).toBe(true);
    // 步骤2: 元数据透传
    const cmd = cmds.find((c) => c.id === "heading") as SlashCommandDef;
    expect(cmd.title).toBe("Heading");
    expect(cmd.keywords).toContain("h1");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
