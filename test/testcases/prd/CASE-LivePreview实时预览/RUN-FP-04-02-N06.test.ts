import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N06: 展开↔折叠往返多次切换稳定且文档无副作用", () => {
  it("步骤1-4: 三轮往返切换状态正确、无重复残留、文档零副作用", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold**\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });

    // 第一轮：折叠 → 展开
    editor.setSelection(source.length);
    expect(container.textContent ?? "").not.toContain("**");
    editor.setSelection(8);
    expect(container.textContent ?? "").toContain("**bold**");
    // 第二轮：再次折叠
    editor.setSelection(source.length);
    expect(container.textContent ?? "").not.toContain("**");
    // 第三轮：再次展开，且无重复/残留
    editor.setSelection(8);
    const text = container.textContent ?? "";
    expect(text).toContain("**bold**");
    expect(text.split("**bold**").length).toBe(2); // 恰好出现一次，无重复挂载
    // 文档零副作用
    expect(editor.getDocument()).toBe(source);
    expect(editor.getSelection().anchor).toBe(8);

    editor.destroy();
    container.remove();
  });
});
