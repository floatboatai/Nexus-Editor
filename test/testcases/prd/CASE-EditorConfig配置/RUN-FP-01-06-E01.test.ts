import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-E01: destroy 后调用 focus/blur 不抛错且不触发回调", () => {
  it("步骤1-2: 不抛错、回调未调用", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, onFocus, onBlur });

    // 步骤1: destroy 后 focus/blur 不抛异常（destroyed 短路保护）
    editor.destroy();
    expect(() => {
      editor.focus();
      editor.blur();
    }).not.toThrow();
    // 步骤2: 回调均未被调用
    expect(onFocus).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();

    container.remove();
  });
});
