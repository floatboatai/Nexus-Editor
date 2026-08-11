import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-N02: blur() 触发 onBlur 回调且焦点离开编辑器", () => {
  it("步骤1-3: events=[focus,blur]、焦点离开、destroy", () => {
    const events: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onFocus: () => events.push("focus"),
      onBlur: () => events.push("blur"),
    });

    // 步骤1: 先 focus 再 blur
    editor.focus();
    editor.blur();
    expect(events).toEqual(["focus", "blur"]);
    // 步骤2: 焦点离开 cm-content
    expect(document.activeElement).not.toBe(container.querySelector(".cm-content"));
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
