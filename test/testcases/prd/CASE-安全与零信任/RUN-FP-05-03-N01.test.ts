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
    initialValue: "```js\nwindow.evil = true;\n```\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-03-N01: js 代码块以纯文本渲染、绝不执行", () => {
  it("步骤1-4: 代码按纯文本展示、脚本未执行、有代码块能力入口", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.textContent).toContain("window.evil = true;");
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
    editor.destroy();
  });
});
