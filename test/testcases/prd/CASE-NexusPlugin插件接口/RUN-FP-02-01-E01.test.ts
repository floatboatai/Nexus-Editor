import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-02-01-E01: 缺失 name 字段的插件对象运行时不崩溃（宽松契约）", () => {
  it("步骤1-3: 创建不抛错、扩展仍注册、文档可读", () => {
    const anonymousPlugin = {
      // 故意省略 name 字段
      shortcuts: [
        {
          key: "Mod-b",
          run() {
            return true;
          },
        },
      ],
    } as any; // TS 编译层面 name 必填，此处绕过类型检查

    const container = document.createElement("div");
    // 步骤1: [STATE] createEditor 不抛出异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "# Hello",
        plugins: [anonymousPlugin],
      });
    }).not.toThrow();
    editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [anonymousPlugin],
    });
    // 步骤2: [API] runShortcut("Mod-b") === true
    expect(editor.runShortcut("Mod-b")).toBe(true);
    // 步骤3: [API] getDocument() === "# Hello"
    expect(editor.getDocument()).toBe("# Hello");

    editor.destroy();
  });
});
