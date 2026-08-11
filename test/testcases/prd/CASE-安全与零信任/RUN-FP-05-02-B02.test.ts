import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  const editor = createEditor({
    container,
    initialValue: "# 标题\n\n正文\n\n[返回](#标题)\n\nend",
    livePreview: true,
  });
  return { container, editor, openSpy };
}

describe("FP-05-02-B02: 锚点 # 链接走标题内部导航、不触发 window.open", () => {
  it("步骤1-4: # 前缀内部导航、open 未调用、光标跳转标题行首", () => {
    const { container, editor, openSpy } = setup();
    editor.setSelection(editor.getDocument().length);

    const link = container.querySelector('[data-link-url="#标题"]');
    expect(link).not.toBeNull();

    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(openSpy).not.toHaveBeenCalled();
    expect(editor.getSelection().anchor).toBe(0);
    editor.destroy();
    openSpy.mockRestore();
  });
});
