import { describe, expect, it } from "vitest";
import { createEditor, lightTheme } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

// 实现差异: EditorConfig 无 themePrefix 字段，主题变量硬编码 --nexus-*（theme.ts:81-99）
function hasNexusVar(needle: string): boolean {
  const nodes = Array.from(document.head.querySelectorAll("style"));
  return nodes.some((s) => s.textContent?.includes(needle));
}

describe("FP-01-04-N01: 默认主题变量以 --nexus- 命名", () => {
  it("步骤1-3: 创建不抛错、样式含 --nexus-bg、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 创建不抛异常（themePrefix 被忽略）
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "# Hello",
        theme: lightTheme,
        themePrefix: "nx-",
      } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 注入样式含 --nexus-bg
    expect(hasNexusVar("--nexus-bg")).toBe(true);
    // 步骤3: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
