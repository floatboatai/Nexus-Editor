import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-N01: focus() 触发 onFocus 回调", () => {
  it("步骤1-3: onFocus 一次、activeElement=cm-content、destroy", () => {
    const onFocus = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, onFocus });

    // 步骤1: focus 触发回调
    editor.focus();
    expect(onFocus).toHaveBeenCalledOnce();
    // 步骤2: 焦点在 cm-content
    expect(document.activeElement).toBe(container.querySelector(".cm-content"));
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
