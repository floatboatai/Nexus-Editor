import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-B01: 空字符串初始文档的边界处理", () => {
  it("步骤1-3: 挂载、空文档、空 AST、销毁", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    // 步骤1: [DOM] 编辑器正常挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: [API] getDocument() === ""
    expect(editor.getDocument()).toBe("");
    // 步骤3: [AST] root 无 children
    expect(editor.getAst().type).toBe("root");
    expect(editor.getAst().children.length).toBe(0);
    expect(() => editor.destroy()).not.toThrow();
  });
});
