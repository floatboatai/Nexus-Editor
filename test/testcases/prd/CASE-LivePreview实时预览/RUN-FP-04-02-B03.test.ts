import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-B03: 多选区混合：一个结构展开、另一个结构折叠共存", () => {
  it("步骤1-4: 双光标生效、展开/折叠共存、标题 mark 齐全", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "# One\n\n# Two";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
      multiCursor: true,
    });
    // heading1 范围 [0,5)，heading2 范围 [7,12)，文档长度 13
    editor.setSelections([{ anchor: 1 }, { anchor: source.length }], 0);

    // 步骤1: 双光标生效
    expect(editor.getSelections().ranges.length).toBe(2);
    // 步骤2: heading1 展开（光标1 在 [0,5) 内）
    const text = container.textContent ?? "";
    expect(text).toContain("# One");
    // 步骤3: heading2 折叠（光标2 在 [7,12) 外）
    expect(text).not.toContain("# Two");
    // 步骤4: 两个标题 mark 均存在
    expect(container.querySelectorAll("[data-heading-level='1']").length).toBe(2);

    editor.destroy();
    container.remove();
  });
});
