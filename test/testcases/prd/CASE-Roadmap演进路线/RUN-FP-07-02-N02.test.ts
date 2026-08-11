import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

describe("FP-07-02-N02: History 插件可加载：Ctrl+Z 撤销 / Ctrl+Y 重做", () => {
  it("步骤1-3: setDocument、撤销、重做", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    // 步骤1: [API] setDocument("next") 生效
    editor.setDocument("next");
    expect(editor.getDocument()).toBe("next");
    // 步骤2: [STATE] Ctrl+Z 撤销回 "start"
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(editor.getDocument()).toBe("start");
    // 步骤3: [STATE] Ctrl+Y 重做回 "next"
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(editor.getDocument()).toBe("next");

    editor.destroy();
  });
});
