import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N02: link 光标移入范围时展开为源码 [text](url) 且 Widget 消失", () => {
  it("步骤1-4: 初始折叠、移入展开、Widget 消失", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Click [here](https://example.com) now\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在末尾（折叠态）
    editor.setSelection(source.length);

    // 步骤1: 初始折叠 widget
    expect(container.querySelector("[data-link-url]")).not.toBeNull();
    // 步骤2: 光标移入 link 范围（"here" 文本内，即位置 7）
    editor.setSelection(7);
    expect(editor.getSelection().anchor).toBe(7);
    // 步骤3: Widget 消失
    expect(container.querySelector("[data-link-url]")).toBeNull();
    // 步骤4: 源码展开
    expect(container.textContent ?? "").toContain("[here](https://example.com)");

    editor.destroy();
    container.remove();
  });
});
