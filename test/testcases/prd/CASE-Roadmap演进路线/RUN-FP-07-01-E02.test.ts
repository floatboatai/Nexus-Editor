import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-E02: 畸形 Markdown 文档解析降级不崩溃", () => {
  it("步骤1-2: 创建不抛错、AST 可读、后续编辑正常", () => {
    const container = document.createElement("div");
    // 步骤1: 畸形文档不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "```\n# 未闭合围栏\n[链接\n| 表格行",
      });
    }).not.toThrow();
    editor = createEditor({
      container,
      initialValue: "```\n# 未闭合围栏\n[链接\n| 表格行",
    });
    // AST 不抛错且为 root
    expect(() => editor.getAst()).not.toThrow();
    expect(editor.getAst().type).toBe("root");
    // 步骤2: 后续编辑正常
    editor.setDocument("ok");
    expect(editor.getDocument()).toBe("ok");
    editor.destroy();
  });
});
