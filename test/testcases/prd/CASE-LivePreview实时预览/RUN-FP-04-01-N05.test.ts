import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N05: image 光标不在结构内时折叠为图片预览 Widget", () => {
  it("步骤1-3: 预览 Widget、img 元素、源码隐藏", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "Before\n\n![alt text](https://img.png)\n\nAfter",
      livePreview: true,
    });
    // 光标在末尾：image 结构范围 [8,40) 之外 → 折叠为预览 Widget
    editor.setSelection(editor.getDocument().length);

    // 步骤1: 图片预览 Widget
    const wrapper = container.querySelector("[data-live-preview-image]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-live-preview-image")).toBe("https://img.png");
    // 步骤2: img 元素（src/alt）
    const img = container.querySelector('img[src="https://img.png"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("alt text");
    // 步骤3: 源码隐藏
    expect(container.textContent ?? "").not.toContain("![");

    editor.destroy();
    container.remove();
  });
});
