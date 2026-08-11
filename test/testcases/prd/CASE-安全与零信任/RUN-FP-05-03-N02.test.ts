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
    initialValue: "start\n\n```html\n<div><script>alert(1)</script></div>\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-N02: 代码块内含 HTML 标签时按纯文本显示、不产生元素", () => {
  it("步骤1-4: HTML 源码按文本显示、无 script 元素、脚本未执行", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.textContent).toContain("<div><script>alert(1)</script></div>");
    expect(container.querySelector("script")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    editor.destroy();
    vi.unstubAllGlobals();
  });
});
