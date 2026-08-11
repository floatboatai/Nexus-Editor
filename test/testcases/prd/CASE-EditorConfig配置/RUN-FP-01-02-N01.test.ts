import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-N01: 初始文档与 getDocument 一致且 AST 正确", () => {
  it("步骤1-3: getDocument、AST heading、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "# Hello" });

    // 步骤1: getDocument
    expect(editor.getDocument()).toBe("# Hello");
    // 步骤2: AST 根为 heading
    const ast = editor.getAst() as Root;
    expect(ast.children[0]?.type).toBe("heading");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
