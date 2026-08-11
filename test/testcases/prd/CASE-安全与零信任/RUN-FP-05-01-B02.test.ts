import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const md = "Intro\n\n<script>alert(1)</script>\n\nend";
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });
  return { container, editor, md };
}

describe("FP-05-01-B02: 光标位于 HTML 块内时显示源码、不进入清洗渲染路径", () => {
  it("步骤1-4: 块外渲染、块内切换源码展示", () => {
    const { container, editor, md } = setup();

    // 步骤1: 光标在文档开头（块外）→ 渲染清洗后的 HTML
    editor.setSelection(0);
    expect(container.querySelector(".nexus-html-block")).not.toBeNull();

    // 步骤2: 移入块内
    editor.setSelection(md.indexOf("alert(1)") + 2);

    // 步骤3: 块内切换为源码展示
    expect(container.querySelector(".nexus-html-block")).toBeNull();

    // 步骤4: 源码原文可见
    expect(container.textContent).toContain("<script>alert(1)</script>");
    editor.destroy();
  });
});
