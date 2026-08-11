import { describe, expect, it } from "vitest";
import { createEditor, lightTheme } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

describe("FP-01-04-E01: themePrefix 含非法字符时不抛错", () => {
  it("步骤1-4: 创建不抛错、挂载、空文档、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 非法 themePrefix 不抛异常（多余字段被忽略）
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        theme: lightTheme,
        themePrefix: "nx theme!",
      } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤3: 空文档
    expect(editor!.getDocument()).toBe("");
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
