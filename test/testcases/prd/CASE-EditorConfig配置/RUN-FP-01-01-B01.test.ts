import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-01-B01: 离屏容器（未挂入 document）不抛错且 DOM 仍挂载", () => {
  it("步骤1-4: 不抛错、DOM 挂载、文档正确、destroy", () => {
    // 容器未追加到 document（离屏场景）
    const container = document.createElement("div");

    // 步骤1: 创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({ container, initialValue: "hello" });
    }).not.toThrow();
    // 步骤2: DOM 挂载到容器本身
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤3: 文档
    expect(editor!.getDocument()).toBe("hello");
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();
  });
});
