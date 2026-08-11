import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-N02: 输入 / 触发 slashMenuChange 且菜单打开", () => {
  it("步骤1-2: 输入 / 触发事件，isOpen=true，commands 含注册命令", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [{ id: "heading", title: "Heading" }],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n",
      plugins: [slashPlugin],
    });

    let lastState: SlashMenuState | null = null;
    editor.on("slashMenuChange", (state) => {
      lastState = state;
    });

    // 步骤1: 光标移到行首（换行后）插入 "/"
    // 修正说明: 源码 getSlashMatch 要求 / 位于行首或前面为空白（防 URL/路径误触发），
    // 用例文档假设在 "start" 后直接输 / 会开菜单，与实际实现不符，改用行首。
    editor.setSelection(6);
    editor.replaceSelection("/");
    // 步骤2: [STATE] isOpen=true，query=""
    expect(editor.getDocument()).toBe("start\n/");
    expect(lastState?.isOpen).toBe(true);
    expect(lastState?.query).toBe("");
    expect(lastState?.commands.map((c) => c.id)).toContain("heading");

    editor.destroy();
  });
});
