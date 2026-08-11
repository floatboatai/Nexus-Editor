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
    initialValue: "```\n\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-B01: 无语言代码块与空代码块安全渲染", () => {
  it("步骤1-4: 空块渲染不报错、正文保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.textContent).toContain("end");
    expect(container.querySelector("script")).toBeNull();
    // copy 按钮无语言时文本为 Copy
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
    editor.destroy();
  });
});
