import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N03: heading 光标移入时展开 # 前缀源码", () => {
  it("步骤1-4: 初始折叠、移入展开、样式保留", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "# Heading\n\nEnd";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在末尾（折叠态）
    editor.setSelection(source.length);

    // 步骤1: 初始折叠态——不含 "# Heading"，标题 mark 存在
    expect(container.textContent ?? "").not.toContain("# Heading");
    expect(container.querySelector("[data-heading-level='1']")).not.toBeNull();
    // 步骤2: 光标移入 heading 内容（范围 [0,9) 内）
    editor.setSelection(3);
    expect(editor.getSelection().anchor).toBe(3);
    // 步骤3: 源码展开
    expect(container.textContent ?? "").toContain("# Heading");
    // 步骤4: 标题 mark 保留
    expect(container.querySelector("[data-heading-level='1']")).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
