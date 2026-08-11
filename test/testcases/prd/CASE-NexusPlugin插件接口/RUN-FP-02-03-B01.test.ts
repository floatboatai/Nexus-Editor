import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-B01: 查询含空白字符时菜单关闭", () => {
  it("步骤1-2: 含空格查询触发事件，isOpen=false", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [{ id: "heading", title: "Heading 1" }],
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

    // 步骤1: 行首插入 "/he lo"（含空格；/ 在行首，若去掉空白检测本应打开，因空白而关闭）
    editor.setSelection(6);
    editor.replaceSelection("/he lo");
    // 步骤2: [STATE] isOpen === false
    expect(editor.getDocument()).toBe("start\n/he lo");
    expect(lastState?.isOpen).toBe(false);
    expect(lastState?.commands.length).toBe(0);

    editor.destroy();
  });
});
