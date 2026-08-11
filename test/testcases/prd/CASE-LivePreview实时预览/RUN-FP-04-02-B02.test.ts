import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-B02: heading 非 inclusiveEnd：光标在 range.to 处仍折叠", () => {
  it("步骤1-4: to 处折叠、to-1 处展开、零副作用", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "# Heading\n\nEnd";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });

    // 步骤1: 光标在 heading 右边界 to=9 → 仍折叠（非 inclusiveEnd）
    editor.setSelection(9);
    expect(container.textContent ?? "").not.toContain("# Heading");
    // 步骤2: 光标移到 to-1=8（heading 内容范围内）
    editor.setSelection(8);
    expect(editor.getSelection().anchor).toBe(8);
    // 步骤3: 展开
    expect(container.textContent ?? "").toContain("# Heading");
    // 步骤4: 文档零副作用
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
