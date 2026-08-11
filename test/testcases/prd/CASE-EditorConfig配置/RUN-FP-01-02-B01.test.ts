import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-B01: initialValue 缺省时为空文档", () => {
  it("步骤1-3: getDocument 空、AST children 空、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container });

    // 步骤1: initialValue ?? "" 回落
    expect(editor.getDocument()).toBe("");
    // 步骤2: AST root children 空
    const ast = editor.getAst() as Root;
    expect(ast.type).toBe("root");
    expect(ast.children.length).toBe(0);
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
