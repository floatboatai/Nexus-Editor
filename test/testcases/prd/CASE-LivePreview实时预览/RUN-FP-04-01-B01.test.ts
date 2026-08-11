import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-B01: table 无论光标位置始终折叠为可编辑 Widget（不随光标展开）", () => {
  it("步骤1-4: 折叠 Widget、源码隐藏、光标移入后仍折叠", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "| a | b |\n|---|---|\n| 1 | 2 |";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在文档开头（表格外）
    editor.setSelection(0);

    // 步骤1: 折叠 Widget（table wrapper + cell）
    expect(container.querySelector(".nexus-table-wrapper")).not.toBeNull();
    expect(container.querySelector(".nexus-cell")).not.toBeNull();
    // 步骤2: 表格源码隐藏
    expect(container.textContent ?? "").not.toContain("|---|---|");
    // 步骤3: 光标移入表格"内部"（分隔行范围内）
    editor.setSelection(2);
    expect(editor.getSelection().anchor).toBe(2);
    // 步骤4: 重新断言折叠状态——table 不随光标展开
    expect(container.querySelector(".nexus-table-wrapper")).not.toBeNull();
    expect(container.textContent ?? "").not.toContain("|---|---|");

    editor.destroy();
    container.remove();
  });
});
