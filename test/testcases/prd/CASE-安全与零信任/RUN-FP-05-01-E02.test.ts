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
    initialValue: 'Intro\n\n<a href="javascript:alert(1)">click</a>\n\nend',
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-E02: javascript: URL 被中和为无害锚点", () => {
  it("步骤1-4: a 保留、href 中和为 #、文本保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("#");
    expect(a?.getAttribute("href")).not.toContain("javascript:");
    expect(container.textContent).toContain("click");
    editor.destroy();
  });
});
