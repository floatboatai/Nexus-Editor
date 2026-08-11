import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-N01: createEditor 基础创建：编辑器挂载 + 初始文档 + AST 根节点解析", () => {
  it("步骤1-4: 挂载、文档、AST、销毁", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Hello",
    });

    // 步骤1: [DOM] .cm-editor 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: [API] getDocument() === "# Hello"
    expect(editor.getDocument()).toBe("# Hello");
    // 步骤3: [AST] root + heading(depth 1)
    const ast = editor.getAst();
    expect(ast.type).toBe("root");
    const first = ast.children[0] as { type: string; depth?: number };
    expect(first.type).toBe("heading");
    expect(first.depth).toBe(1);
    // 步骤4: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
  });
});
