import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-02-B02: initialValue 为空字符串时正常创建", () => {
  it("步骤1-4: 创建不抛错、空文档、可继续编辑、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 空字符串创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({ container, initialValue: "" });
    }).not.toThrow();
    // 步骤2: getDocument 空
    expect(editor!.getDocument()).toBe("");
    // 步骤3: setDocument 可继续编辑
    editor!.setDocument("abc");
    expect(editor!.getDocument()).toBe("abc");
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
