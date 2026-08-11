import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-D01: 大文档（100 行）初始化后内容逐行完整保留", () => {
  it("步骤1-4: 原文一致、100 行、首尾行、AST root、destroy", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `行 ${i + 1}`);
    const source = lines.join("\n");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: source });

    // 步骤1: getDocument 与原文一致
    expect(editor.getDocument()).toBe(source);
    // 步骤2: 拆分 100 行，首尾正确
    const split = editor.getDocument().split("\n");
    expect(split).toHaveLength(100);
    expect(split[0]).toBe("行 1");
    expect(split[99]).toBe("行 100");
    // 步骤3: AST root
    expect((editor.getAst() as Root).type).toBe("root");
    // 步骤4: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
