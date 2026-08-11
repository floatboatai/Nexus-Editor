import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashCommandDef, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-E01: slashMenuLimit 为 0 时菜单打开但命令列表为空", () => {
  it("步骤1-2: 输入 / 触发事件，isOpen=true 且 commands 为空", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [{ id: "heading", title: "Heading" }],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start\n",
      plugins: [slashPlugin],
      slashMenuLimit: 0,
    });

    let lastState: SlashMenuState | null = null;
    editor.on("slashMenuChange", (state) => {
      lastState = state;
    });

    // 步骤1: 行首输入 "/"（/ 需在行首，见 N02 修正说明）
    editor.setSelection(6);
    editor.replaceSelection("/");
    // 步骤2: [STATE] isOpen=true 但 commands 为空
    expect(editor.getDocument()).toBe("start\n/");
    expect(lastState?.isOpen).toBe(true);
    expect(lastState?.commands).toEqual([]);

    editor.destroy();
  });
});
