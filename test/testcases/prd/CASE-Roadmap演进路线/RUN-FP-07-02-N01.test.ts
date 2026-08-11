import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

describe("FP-07-02-N01: GFM preset 可加载：表格与任务列表 AST 解析生效", () => {
  it("步骤1-3: table 节点、checked listItem、destroy", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| a | b |\n| - | - |\n| 1 | 2 |",
      plugins: [createGfmPreset()],
    });

    // 步骤1: [AST] 表格解析为 table 节点
    const ast = editor.getAst();
    expect(ast.children[0]?.type).toBe("table");
    // 步骤2: [AST] 任务列表 listItem.checked === true
    editor.setDocument("- [x] done");
    const list = editor.getAst().children[0] as {
      type: string;
      children?: Array<{ type: string; checked?: boolean | null }>;
    };
    expect(list.type).toBe("list");
    expect(list.children?.[0]?.checked).toBe(true);
    // 步骤3: [STATE] destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();
  });
});
