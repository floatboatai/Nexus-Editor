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
    initialValue: "```\n`ticks` \\` and 中文 ✓\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-B02: 代码块含反引号与特殊字符时原样显示", () => {
  it("步骤1-4: 反引号与特殊字符原样保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.textContent).toContain("`ticks`");
    expect(container.textContent).toContain("中文 ✓");
    expect(container.querySelector("script")).toBeNull();
    editor.destroy();
  });
});
