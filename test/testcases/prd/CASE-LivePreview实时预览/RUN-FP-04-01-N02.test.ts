import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N02: link 光标不在结构内时折叠为 data-link-url Widget", () => {
  it("步骤1-3: 折叠 Widget、源码隐藏、文档不变", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const source = "Click [here](https://example.com) now\n\nend";
    const editor = createEditor({
      container,
      initialValue: source,
      livePreview: true,
    });
    // 光标在文档末尾：link 结构范围 [6,33) 之外 → 折叠为 Widget
    editor.setSelection(source.length);

    // 步骤1: 折叠 Widget（data-link-url 属性 + 链接文本）
    const widget = container.querySelector("[data-link-url]");
    expect(widget).not.toBeNull();
    expect(widget?.getAttribute("data-link-url")).toBe("https://example.com");
    expect(widget?.textContent).toBe("here");
    // 步骤2: 源码隐藏
    const text = container.textContent ?? "";
    expect(text).not.toContain("[here](");
    // 步骤3: 文档不变
    expect(editor.getDocument()).toBe(source);

    editor.destroy();
    container.remove();
  });
});
