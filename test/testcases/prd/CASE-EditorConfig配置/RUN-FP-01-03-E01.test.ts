import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { EditorCommand } from "@floatboat/nexus-core";

describe("FP-01-03-E01: 多插件注册同 id 命令时先注册者优先", () => {
  it("步骤1-3: getCommands 命中 firstRun、runCommand 返回 true、destroy", () => {
    const firstRun = () => "first";
    const secondRun = () => "second";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      plugins: [
        { name: "plugin-a", commands: [{ id: "same", run: firstRun }] },
        { name: "plugin-b", commands: [{ id: "same", run: secondRun }] },
      ],
    });

    // 步骤1: 先注册者优先
    const cmd = editor.getCommands().find((c) => c.id === "same") as EditorCommand;
    expect(cmd.run).toBe(firstRun);
    // 步骤2: runCommand 返回 true
    expect(editor.runCommand("same")).toBe(true);
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
