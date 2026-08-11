import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, EditorAPI } from "@floatboat/nexus-core";

describe("FP-02-03-F01: 命令 run 钩子由宿主调用并修改文档（流程）", () => {
  it("步骤1-2: run 返回 true，文档开头插入分隔线", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [
        {
          id: "insert-hr",
          title: "Horizontal Rule",
          run(api) {
            api.replaceSelection("\n\n---\n\n");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [slashPlugin],
    });

    // 步骤1: [API] 获取命令对象
    const cmd = editor.getSlashCommands()[0]!;
    expect(cmd.id).toBe("insert-hr");
    expect(typeof cmd.run).toBe("function");
    // 步骤2: [API] 手动调用 run（初始光标 offset 0，插入到文档开头）
    const result = cmd.run!(editor as EditorAPI);
    expect(result).toBe(true);
    expect(editor.getDocument()).toBe("\n\n---\n\nstart");

    editor.destroy();
  });
});
