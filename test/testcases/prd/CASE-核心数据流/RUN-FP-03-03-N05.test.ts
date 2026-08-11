import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "![alt](img.png)\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-N05: 图片节点→data-live-preview-image Widget（源码替换为预览）", () => {
  it("步骤1-4: Widget 存在、URL 属性、img src/alt、源码隐藏", () => {
    const { container, editor } = setup();
    const wrapper = container.querySelector("[data-live-preview-image]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-live-preview-image")).toBe("img.png");
    // 注意: CM6 widget 会插入 img.cm-widgetBuffer 占位符，必须用带作用域的 selector 定位真实图片
    const img = container.querySelector("[data-live-preview-image] img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("img.png");
    expect(img?.getAttribute("alt")).toBe("alt");
    expect(container.textContent).not.toContain("![alt](img.png)");
    editor.destroy();
  });
});
