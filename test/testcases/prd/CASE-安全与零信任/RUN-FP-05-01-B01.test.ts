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
    initialValue: "Intro\n\n<!-- 这是注释 -->\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-B01: HTML 注释块以 textContent 渲染、不注入 innerHTML", () => {
  it("步骤1-4: 注释走专门文本渲染路径、正文不受影响", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    const comment = container.querySelector(".nexus-html-comment");
    expect(comment).not.toBeNull();
    expect(comment?.textContent).toContain("<!-- 这是注释 -->");
    expect(container.textContent).toContain("Intro");
    editor.destroy();
  });
});
