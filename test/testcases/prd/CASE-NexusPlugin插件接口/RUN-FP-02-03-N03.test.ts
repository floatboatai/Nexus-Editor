import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin, SlashMenuState } from "@floatboat/nexus-core";

describe("FP-02-03-N03: 输入 /hea 按标题前缀过滤排序", () => {
  it("步骤1-2: 文档更新，查询过滤为仅 heading", () => {
    const slashPlugin: NexusPlugin = {
      name: "slash-plugin",
      slashCommands: [
        { id: "heading", title: "Heading 1" },
        { id: "table", title: "Table" },
      ],
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

    // 步骤1: 行首插入 "/hea"（/ 位于行首才触发菜单，见 N02 修正说明）
    editor.setSelection(6);
    editor.replaceSelection("/hea");
    // 步骤2: [STATE] query === "hea"，仅命中 heading
    expect(editor.getDocument()).toBe("start\n/hea");
    expect(lastState?.isOpen).toBe(true);
    expect(lastState?.query).toBe("hea");
    expect(lastState?.commands.map((c) => c.id)).toEqual(["heading"]);

    editor.destroy();
  });
});
