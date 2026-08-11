import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-01-F02: destroy 后编辑器 DOM 从容器移除", () => {
  it("步骤1-2: destroy 不抛异常、DOM 移除", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "text" });

    // 步骤1: destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
    // 步骤2: DOM 已清理
    expect(container.querySelector(".cm-editor")).toBeNull();

    container.remove();
  });
});
