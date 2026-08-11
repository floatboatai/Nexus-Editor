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
    initialValue: "正文 [外部](https://example.com) 继续\n\nend",
    livePreview: true,
  });
  return { container, editor, openSpy };
}

describe("FP-05-02-E01: 点击行内链接不产生任何文档编辑副作用", () => {
  it("步骤1-4: 点击后 getDocument 与选区均不变", () => {
    const { container, editor, openSpy } = setup();
    const before = editor.getDocument();
    editor.setSelection(editor.getDocument().length);
    const beforeSelection = editor.getSelection();

    const link = container.querySelector("[data-link-url]");
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(editor.getDocument()).toBe(before);
    expect(editor.getSelection()).toEqual(beforeSelection);
    editor.destroy();
    openSpy.mockRestore();
  });
});
