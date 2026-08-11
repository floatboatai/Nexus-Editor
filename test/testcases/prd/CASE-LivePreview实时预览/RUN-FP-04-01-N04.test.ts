import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N04: 无序列表光标不在该项首行时折叠为 bullet/checkbox Widget", () => {
  it("步骤1-3: bullet/checkbox Widget、已完成项样式", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "- item one\n- [x] done\n\nend",
      livePreview: true,
    });
    // 光标在末尾行，不在任一列表项首行 → 折叠 marker/checkbox
    editor.setSelection(editor.getDocument().length);

    // 步骤1: bullet Widget（• 替换 - marker）
    const text = container.textContent ?? "";
    expect(text).toContain("•");
    expect(text).toContain("item one");
    expect(text).toContain("done");
    expect(text).not.toContain("- item");
    expect(text).not.toContain("[x]");
    // 步骤2: checkbox Widget（[x] → checked）
    const cb = container.querySelector('input[type="checkbox"]');
    expect(cb).not.toBeNull();
    expect((cb as HTMLInputElement).checked).toBe(true);
    // 步骤3: 已完成项 line-through 样式
    expect(container.querySelector('[style*="line-through"]')).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
