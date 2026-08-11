import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-N02: 键盘事件实际触发快捷键（CM6 keymap 路径）", () => {
  it("步骤1-2: keydown 触发快捷键，setDocument 生效", () => {
    const keyboardPlugin: NexusPlugin = {
      name: "keyboard-shortcut",
      shortcuts: [
        {
          key: "Ctrl-k",
          run(api) {
            api.setDocument("shortcut-keyboard");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [keyboardPlugin],
    });

    // 步骤1: [EVENT] 向 contenteditable 派发 Ctrl+k keydown
    const content = container.querySelector<HTMLElement>("[contenteditable='true']")!;
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    // 步骤2: [API] 文档被快捷键修改
    expect(editor.getDocument()).toBe("shortcut-keyboard");

    editor.destroy();
  });
});
