import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N01: heading 光标不在结构内时折叠 # 前缀为标题 Widget", () => {
  it("步骤1-3: 折叠态、标题 Widget 渲染、文档不变", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "Intro\n\n# Heading\n\nEnd",
      livePreview: true,
    });
    // 光标移动到文档末尾（heading 结构范围 [7,16) 之外）
    editor.setSelection(editor.getDocument().length);

    // 步骤1: 折叠态——含标题文本但不含 "# Heading"
    const text = container.textContent ?? "";
    expect(text).toContain("Heading");
    expect(text).not.toContain("# Heading");
    // 步骤2: 标题 Widget（data-heading-level）
    const widget = container.querySelector("[data-heading-level='1']");
    expect(widget).not.toBeNull();
    expect(widget?.textContent).toBe("Heading");
    // 步骤3: 文档不变
    expect(editor.getDocument()).toBe("Intro\n\n# Heading\n\nEnd");

    editor.destroy();
    container.remove();
  });
});
