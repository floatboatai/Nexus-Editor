import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

describe("FP-01-01-E02: container 为 null 时编辑器仍可创建（CM6 允许 parent 为 null）", () => {
  it("步骤1: container 为 null 创建成功且文档可读", () => {
    // 实测：CM6 EditorView 构造时 parent 为 null 不抛错，编辑器正常创建
    const editor = createEditor({
      container: null,
      initialValue: "hi",
    } as unknown as EditorConfig);
    expect(editor.getDocument()).toBe("hi");
    expect(() => editor.destroy()).not.toThrow();
  });
});
