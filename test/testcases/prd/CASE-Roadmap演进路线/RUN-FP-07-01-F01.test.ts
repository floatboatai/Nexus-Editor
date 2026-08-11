import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-F01: destroy 清理 DOM 且幂等", () => {
  it("步骤1-3: destroy 后 DOM 移除、重复 destroy 不抛错", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "start" });
    expect(container.querySelector(".cm-editor")).not.toBeNull();

    // 步骤1: [STATE] 首次 destroy 不抛错
    expect(() => editor.destroy()).not.toThrow();
    // 步骤2: [DOM] .cm-editor 移除
    expect(container.querySelector(".cm-editor")).toBeNull();
    // 步骤3: [STATE] 重复 destroy 幂等不抛错
    expect(() => editor.destroy()).not.toThrow();
  });
});
