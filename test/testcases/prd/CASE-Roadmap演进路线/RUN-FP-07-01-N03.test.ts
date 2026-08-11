import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-N03: 基础 Live Preview 装饰器开启后链接渲染为可交互元素", () => {
  it("步骤1-4: 光标移出链接行、链接元素、源码隐藏、销毁", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Click [here](https://example.com)\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });

    // 步骤1: [STATE] 光标移到文档末尾
    editor.setSelection(editor.getDocument().length);
    expect(editor.getSelection().anchor).toBe(source.length);
    // 步骤2: [DOM] data-link-url 元素存在且 URL 正确
    const link = container.querySelector("[data-link-url]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-link-url")).toBe("https://example.com");
    // 步骤3: [DOM] 源码标记被替换隐藏
    expect(container.textContent ?? "").not.toContain("](https://example.com)");
    // 步骤4: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
    container.remove();
  });
});
