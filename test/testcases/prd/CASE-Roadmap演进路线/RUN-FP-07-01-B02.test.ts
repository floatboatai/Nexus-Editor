import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-07-01-B02: 中文/全角文本（CJK 及全角标点）", () => {
  it("步骤1-2: 中文文档、AST 标题、光标定位", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# 你好，世界" });

    // 步骤1: [API] 中文文档完整保留
    expect(editor.getDocument()).toBe("# 你好，世界");
    const ast = editor.getAst();
    expect(ast.children[0]?.type).toBe("heading");
    // 步骤2: [API] 光标定位到 CJK 偏移（"# " 为 2，7 落在"你好"之后）
    editor.setSelection(7);
    expect(editor.getSelection().anchor).toBe(7);
    editor.destroy();
  });
});
