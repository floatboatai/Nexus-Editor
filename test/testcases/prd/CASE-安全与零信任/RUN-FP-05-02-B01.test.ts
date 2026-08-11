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
    initialValue: "访问 <https://example.com> 吧\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-02-B01: 自动链接受控渲染为 data-link-url 标记", () => {
  it("步骤1-4: autolink 渲染为 span[data-link-url]、无 a[href]", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const el = container.querySelector('[data-link-url="https://example.com"]');
    expect(el).not.toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
    expect(el?.textContent).toBe("https://example.com");
    editor.destroy();
  });
});
