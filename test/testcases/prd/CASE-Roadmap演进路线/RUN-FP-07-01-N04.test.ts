import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-N04: setDocument 全量替换后 AST 与目录同步更新", () => {
  it("步骤1-3: 文档替换、AST 结构、目录更新", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Title" });

    // 步骤1: [API] setDocument 同步生效
    editor.setDocument("## Section A\n\nSome text");
    expect(editor.getDocument()).toBe("## Section A\n\nSome text");
    // 步骤2: [AST] heading(depth 2) + paragraph("Some text")
    const ast = editor.getAst();
    const h = ast.children[0] as { type: string; depth?: number };
    const p = ast.children[1] as { type: string; children?: Array<{ type: string; value?: string }> };
    expect(h.type).toBe("heading");
    expect(h.depth).toBe(2);
    expect(p.type).toBe("paragraph");
    expect(p.children?.[0]?.value).toBe("Some text");
    // 步骤3: [API] 目录同步
    const toc = editor.getTableOfContents();
    expect(toc[0]?.level).toBe(2);
    expect(toc[0]?.text).toBe("Section A");

    editor.destroy();
  });
});
