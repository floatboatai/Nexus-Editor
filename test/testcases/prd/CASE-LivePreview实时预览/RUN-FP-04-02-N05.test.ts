import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-02-N05: image 光标移入时源码可见且预览 Widget 保留", () => {
  it("步骤1-4: 初始折叠、移入展开、预览保留", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Before\n\n![alt](https://img.png)\n\nAfter";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 初始光标在末尾（折叠态：仅预览 Widget）
    editor.setSelection(source.length);

    // 步骤1: 初始折叠态——不含 ![，预览 widget 存在
    expect(container.textContent ?? "").not.toContain("![");
    expect(container.querySelector("[data-live-preview-image]")).not.toBeNull();
    // 步骤2: 光标移入 image 范围（[8,26) 内）
    editor.setSelection(10);
    expect(editor.getSelection().anchor).toBe(10);
    // 步骤3: 源码展开
    expect(container.textContent ?? "").toContain("![alt](https://img.png)");
    // 步骤4: 预览保留（源码 + 预览 widget 共存）
    expect(container.querySelector("[data-live-preview-image]")).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
