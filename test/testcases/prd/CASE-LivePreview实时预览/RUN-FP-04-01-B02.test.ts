import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-B02: 嵌套格式 ***bold italic*** 折叠时无残留标记", () => {
  it("步骤1-3: 内容保留、无残留标记、复合样式", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "Text ***bold italic***\n\nend",
      livePreview: true,
    });
    // 光标在末尾行，与嵌套结构不同行 → 折叠
    editor.setSelection(editor.getDocument().length);

    // 步骤1: 内容保留
    const text = container.textContent ?? "";
    expect(text).toContain("bold italic");
    // 步骤2: 无残留标记
    expect(text).not.toContain("***");
    expect(text).not.toContain("**");
    // 步骤3: 复合样式（font-weight + font-style）
    expect(container.querySelector('[style*="font-weight"]')).not.toBeNull();
    expect(container.querySelector('[style*="font-style"]')).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
