import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "@floatboat/nexus-core";

describe("FP-07-01-N02: setDocument 编辑后文档同步并触发 change 事件", () => {
  it("步骤1-3: 文档更新、change 事件载荷、二次更新 AST", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "# Hello",
    });
    editor.on("change", handler);

    // 步骤1: [API] setDocument("# World") 同步生效
    editor.setDocument("# World");
    expect(editor.getDocument()).toBe("# World");
    // 步骤2: [EVENT] 末次载荷 doc === "# World"，ast.children[0] 为 heading
    const last = handler.mock.calls[handler.mock.calls.length - 1];
    expect(last[0]).toBe("# World");
    expect((last[1] as Root).children[0]?.type).toBe("heading");
    // 步骤3: [AST] 再次 setDocument 后末次 ast.children.length === 2
    editor.setDocument("# A\n\nParagraph");
    const last2 = handler.mock.calls[handler.mock.calls.length - 1];
    expect((last2[1] as Root).children.length).toBe(2);

    editor.destroy();
  });
});
