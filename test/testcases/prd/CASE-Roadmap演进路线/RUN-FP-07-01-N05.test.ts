import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-N05: 复杂文档 AST 结构完整（标题/段落/列表/引用/行内代码）", () => {
  it("步骤1-4: 类型序列、列表、引用、销毁", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: [
        "# Title",
        "",
        "Paragraph one.",
        "",
        "- item a",
        "- item b",
        "",
        "> quote",
        "",
        "`code`",
      ].join("\n"),
    });

    // 步骤1: [AST] 顶层类型序列
    const ast = editor.getAst();
    const types = ast.children.map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "list", "blockquote", "paragraph"]);
    // 步骤2: [AST] list 含 2 个 listItem
    const list = ast.children[2] as { type: string; children: unknown[] };
    expect(list.type).toBe("list");
    expect(list.children.length).toBe(2);
    // 步骤3: [AST] blockquote 文本为 "quote"
    const quote = ast.children[3] as {
      type: string;
      children?: Array<{ type: string; children?: Array<{ type: string; value?: string }> }>;
    };
    expect(quote.type).toBe("blockquote");
    expect(quote.children?.[0]?.children?.[0]?.value).toBe("quote");
    // 步骤4: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
  });
});
