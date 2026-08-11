import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N03: 行内 strong/emphasis/inlineCode 光标在另一行时折叠语法标记", () => {
  it("步骤1-3: 内容保留、标记隐藏、样式保留", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "Text **bold** *italic* `code`\n\nend",
      livePreview: true,
    });
    // 光标在末尾行（end 行），与三个行内结构不在同一行 → 行级折叠
    editor.setSelection(editor.getDocument().length);

    // 步骤1: 内容文本保留
    const text = container.textContent ?? "";
    expect(text).toContain("bold");
    expect(text).toContain("italic");
    expect(text).toContain("code");
    // 步骤2: 语法标记隐藏
    expect(text).not.toContain("**");
    expect(text).not.toContain("*");
    expect(text).not.toContain("`");
    // 步骤3: 样式保留（font-weight 加粗 + font-style 斜体 mark）
    expect(container.querySelector('[style*="font-weight"]')).not.toBeNull();
    expect(container.querySelector('[style*="font-style"]')).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
