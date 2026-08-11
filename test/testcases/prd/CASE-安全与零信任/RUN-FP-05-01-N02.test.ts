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
    initialValue: 'Intro\n\n<div class="hostile" onclick="alert(1)" onerror="evil()">ok</div>\n\nend',
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-N02: 内联事件属性 onclick/onerror 被剥离而元素保留", () => {
  it("步骤1-5: hostile 元素保留、onclick/onerror 剥离、文本保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const hostile = container.querySelector(".hostile");
    expect(hostile).not.toBeNull();
    expect(hostile?.hasAttribute("onclick")).toBe(false);
    expect(hostile?.hasAttribute("onerror")).toBe(false);
    expect(hostile?.textContent).toContain("ok");
    editor.destroy();
  });
});
