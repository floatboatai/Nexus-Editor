import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold**\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-B01: 光标进入结构时恢复源码 marker（编辑态展开）", () => {
  it("步骤1-4: 行外隐藏→行内恢复→文档不变", () => {
    const { container, editor } = setup();
    expect(container.textContent).not.toContain("**bold**");
    editor.setSelection(8);
    expect(container.textContent).toContain("**bold**");
    expect(editor.getDocument()).toBe("Text **bold**\n\nend");
    editor.destroy();
  });
});
