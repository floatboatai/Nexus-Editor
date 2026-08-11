import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-02-N02: 行内链接渲染为 data-link-url 标记、URL 不注入 href", () => {
  it("步骤1-5: span[data-link-url] 存在、非 a、无 href、文本正确", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const el = container.querySelector('[data-link-url="https://example.com"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("SPAN");
    expect(container.querySelector("a[href]")).toBeNull();
    expect(el?.textContent).toBe("外部");
    editor.destroy();
  });
});
