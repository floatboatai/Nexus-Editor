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
    initialValue: '```html\n<img src="x" onerror="evil()">\n```\n\nend',
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-E03: 代码块中事件属性字符串仅按文本渲染、不产生事件绑定", () => {
  it("步骤1-4: onerror 字符串按文本显示、无 onerror 元素、脚本未执行", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.textContent).toContain('onerror="evil()"');
    expect(container.querySelector("[onerror]")).toBeNull();
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    editor.destroy();
  });
});
