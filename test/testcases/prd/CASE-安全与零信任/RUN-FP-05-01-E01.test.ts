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
    initialValue:
      "Intro\n\n<iframe src=\"evil.com\"></iframe><object data=\"evil\"></object>" +
      "<embed src=\"evil.swf\"><style>body{display:none}</style>ok\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-E01: iframe/object/embed/style 危险元素被整体移除", () => {
  it("步骤1-6: 四种危险元素全部移除、普通文本保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(container.textContent).toContain("ok");
    editor.destroy();
  });
});
