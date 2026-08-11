import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

describe("FP-01-01-E01: 缺省 container 时编辑器仍可创建（CM6 允许 parent 缺省）", () => {
  it("步骤1: 缺省 container 创建成功且文档可读", () => {
    // 实测：CM6 EditorView 构造时 parent 为 undefined 不抛错，编辑器正常创建
    const editor = createEditor({ initialValue: "hi" } as EditorConfig);
    expect(editor.getDocument()).toBe("hi");
    expect(() => editor.destroy()).not.toThrow();
  });
});
