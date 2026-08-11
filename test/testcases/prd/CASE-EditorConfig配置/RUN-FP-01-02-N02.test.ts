import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-N02: 复杂 Markdown 初始化后 AST 结构与原文完整保留", () => {
  it("步骤1-3: getDocument 原文、AST 节点类型、destroy", () => {
    const source = "# 标题\n\n- 项一\n- 项二\n\n**加粗** 与 *斜体*";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: source });

    // 步骤1: 原文逐字符一致
    expect(editor.getDocument()).toBe(source);
    // 步骤2: AST 顶层节点类型
    const types = (editor.getAst() as Root).children.map((n) => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("list");
    expect(types).toContain("paragraph");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
