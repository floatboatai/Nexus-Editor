import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N04: code 块光标移入时 fence 恢复可见", () => {
  it("步骤1-4: 初始透明、移入恢复、源码可见", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "before\n\n```js\nconst a = 1;\n```\n\nafter";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在末尾（折叠态：fence 透明）
    editor.setSelection(source.length);

    // 步骤1: 初始折叠态——fence 透明
    expect(container.querySelector('[style*="transparent"]')).not.toBeNull();
    // 步骤2: 光标移入 code 块（fence 内，范围 [7,32) 内）
    editor.setSelection(10);
    expect(editor.getSelection().anchor).toBe(10);
    // 步骤3: fence 恢复可见（不再 transparent）
    expect(container.querySelector('[style*="transparent"]')).toBeNull();
    // 步骤4: 源码可见
    const text = container.textContent ?? "";
    expect(text).toContain("```js");
    expect(text).toContain("const a = 1;");

    editor.destroy();
    container.remove();
  });
});
