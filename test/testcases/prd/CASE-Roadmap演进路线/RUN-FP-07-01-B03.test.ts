import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-B03: 超长文档（1000 行）解析性能与稳定性", () => {
  it("步骤1-3: 创建不抛错、行数正确、AST 行数正确", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) lines.push(`Line ${i}`);
    const doc = lines.join("\n");

    const container = document.createElement("div");
    let editor: ReturnType<typeof createEditor>;
    // 步骤1: [STATE] 创建不抛异常
    expect(() => {
      editor = createEditor({ container, initialValue: doc });
    }).not.toThrow();
    editor = createEditor({ container, initialValue: doc });
    // 步骤2: [API] 文档行数 1000
    expect(editor.getDocument().split("\n").length).toBe(1000);
    // 步骤3: [AST] 修正说明: 连续文本行（无空行分隔）在 Markdown 中为同一段落（软换行），
    // 用例文档假设 children.length === 1000 不符合 markdown 语义；实测解析为 1 个 paragraph。
    const ast = editor.getAst();
    expect(ast.children.length).toBe(1);
    expect(ast.children[0]?.type).toBe("paragraph");
    expect(() => editor.destroy()).not.toThrow();
  });
});
