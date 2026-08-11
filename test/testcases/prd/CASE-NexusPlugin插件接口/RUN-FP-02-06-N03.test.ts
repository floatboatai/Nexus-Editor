import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { keymap } from "@codemirror/view";

describe("FP-02-06-N03: cmExtensions 中 keymap 绑定生效", () => {
  it("步骤1-2: Mod+b 键盘事件触发 keymap，文档被修改", () => {
    const keymapPlugin: NexusPlugin = {
      name: "keymap-plugin",
      cmExtensions: [
        keymap.of([
          {
            key: "Mod-b",
            run(view: any) {
              // ⚠️ CM6 keymap run 的参数是 EditorView 而非 EditorAPI
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: "bold-toogled" },
              });
              return true;
            },
          },
        ]),
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [keymapPlugin],
    });

    // 步骤1: [EVENT] 派发 Mod+b keydown
    // 修正说明: jsdom 中 navigator.platform 为空，CM6 将 Mod 解析为 Ctrl，
    // 因此用 ctrlKey: true 触发（与 FP-02-02-N02 一致）。
    const content = container.querySelector<HTMLElement>("[contenteditable='true']")!;
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    // 步骤2: [API] 文档被 keymap 修改
    expect(editor.getDocument()).toBe("bold-toogled");

    editor.destroy();
  });
});
