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
    initialValue: "Intro\n\n<div class=\"hostile\"><script>window.evil=true;</script>safe</div>\n\nend",
    livePreview: {
      renderers: {
        html: () => {
          const div = document.createElement("div");
          div.className = "custom-html-block";
          div.textContent = "custom-sanitized";
          return div;
        },
      },
    },
  });
  return { container, editor };
}

describe("FP-05-01-F01: 宿主自定义 renderers.html 优先于默认清洗渲染", () => {
  it("步骤1-4: 自定义渲染器接管、无 script 元素、结果来自自定义清洗", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    expect(container.querySelector(".custom-html-block")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("custom-sanitized");
    editor.destroy();
  });
});
