import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N01: strong 光标移入所在行时展开为源码 **bold**", () => {
  it("步骤1-4: 初始折叠、移入展开、文档不变", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Text **bold**\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在末尾行（折叠态）
    editor.setSelection(source.length);

    // 步骤1: 初始折叠态——不含 **
    expect(container.textContent ?? "").not.toContain("**");
    // 步骤2: 光标移入 bold 所在行（**bold** 范围内）
    editor.setSelection(8);
    expect(editor.getSelection().anchor).toBe(8);
    // 步骤3: 展开源码
    expect(container.textContent ?? "").toContain("**bold**");
    // 步骤4: 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
