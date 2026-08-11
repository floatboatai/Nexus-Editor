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
    initialValue: "Intro\n\n<script>window.evil=true;</script>safe content\n\nend",
    livePreview: true,
  });
  return { container, editor };
}

describe("FP-05-01-N01: HTML 块中的 script 标签被整体移除且其余内容保留", () => {
  it("步骤1-4: HTML 块渲染、script 移除、脚本未执行、正常内容保留", () => {
    const { container, editor } = setup();
    editor.setSelection(editor.getDocument().length);

    // 步骤1: HTML 块渲染
    expect(container.querySelector(".nexus-html-block")).not.toBeNull();
    expect(container.querySelector(".nexus-html-block-content")).not.toBeNull();
    // 步骤2: script 标签整体移除
    expect(container.querySelector("script")).toBeNull();
    // 步骤3: 恶意脚本未执行
    expect((window as { evil?: boolean }).evil).toBeUndefined();
    // 步骤4: 正常内容保留
    expect(container.textContent).toContain("safe content");
    editor.destroy();
  });
});
