import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-B01: 连续 focus 不重复触发 onFocus（幂等）", () => {
  it("步骤1-3: onFocus 一次、焦点保持、destroy", () => {
    const onFocus = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, onFocus });

    // 步骤1: 连续两次 focus，onFocus 仅一次
    editor.focus();
    editor.focus();
    expect(onFocus).toHaveBeenCalledOnce();
    // 步骤2: 焦点保持
    expect(document.activeElement).toBe(container.querySelector(".cm-content"));
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
