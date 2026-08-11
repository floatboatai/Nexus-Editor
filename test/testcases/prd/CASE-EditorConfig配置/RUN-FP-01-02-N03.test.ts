import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-N03: 中文等多字节内容初始化正确", () => {
  it("步骤1-3: getDocument 原文、paragraph AST、destroy", () => {
    const source = "你好，Nexus 编辑器！\n第二行内容";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: source });

    // 步骤1: 多字节字符完整保留
    expect(editor.getDocument()).toBe(source);
    // 步骤2: 纯文本两行解析为 paragraph
    expect((editor.getAst() as Root).children[0]?.type).toBe("paragraph");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
