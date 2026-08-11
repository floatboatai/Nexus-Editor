import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const md = "start\n\n```js\nconst a = 1;\n```\n\nend";
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });
  return { container, editor, md };
}

function fenceSpan(container: HTMLElement) {
  return [...container.querySelectorAll(".cm-line span")].find(
    (s) => (s.textContent ?? "").trim() === "```js"
  ) as HTMLElement | undefined;
}

describe("FP-05-03-F01: 光标进出代码块在渲染态与源码可编辑态间切换", () => {
  it("步骤1-4: 光标在外 fence 透明、移入变可见、移出恢复", () => {
    const { container, editor, md } = setup();

    // 步骤1: 光标位于文档开头（块外前导段）→ 渲染态（fence 行透明）
    editor.setSelection(0);
    const outside = fenceSpan(container);
    expect(outside).toBeDefined();
    expect(outside?.style.color).toBe("transparent");

    // 步骤2-3: 移入块内 → 源码可编辑态（fence 可见）
    editor.setSelection(md.indexOf("const a = 1") + 1);
    const inside = fenceSpan(container);
    expect(inside).toBeDefined();
    expect(inside?.style.color).not.toBe("transparent");

    // 步骤4: 移出块外 → 恢复渲染态
    editor.setSelection(0);
    const outsideAgain = fenceSpan(container);
    expect(outsideAgain?.style.color).toBe("transparent");
    editor.destroy();
  });
});
