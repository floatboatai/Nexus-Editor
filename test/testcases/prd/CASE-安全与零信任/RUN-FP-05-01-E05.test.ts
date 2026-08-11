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
    initialValue: "Intro\n\n<div><script>window.evil=true;</script>safe</div>\n\nend",
    livePreview: {
      renderers: {
        html: () => {
          throw new Error("custom renderer crashed");
        },
      },
    },
  });
  return { container, editor };
}

describe("FP-05-01-E05: 自定义 html 渲染器抛错时回退默认清洗路径", () => {
  it("步骤1-5: 回退默认渲染、script 仍被清洗、safe 保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.querySelector(".nexus-html-block")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    expect(container.textContent).toContain("safe");
    editor.destroy();
  });
});
