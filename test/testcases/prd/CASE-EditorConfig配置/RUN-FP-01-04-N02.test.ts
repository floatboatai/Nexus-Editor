import { describe, expect, it } from "vitest";
import { createEditor, lightTheme } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

function hasNexusVar(needle: string): boolean {
  const nodes = Array.from(document.head.querySelectorAll("style"));
  return nodes.some((s) => s.textContent?.includes(needle));
}

describe("FP-01-04-N02: 自定义 themePrefix 后主题变量名随之变化", () => {
  it("步骤1-4: 创建不抛错、--my-bg 不存在、--nexus-bg 存在、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 创建不抛异常（themePrefix 为多余字段被忽略）
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        theme: lightTheme,
        themePrefix: "my-",
      } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 实现差异——--my-bg 不出现
    expect(hasNexusVar("--my-bg")).toBe(false);
    // 步骤3: 实际为 --nexus-bg
    expect(hasNexusVar("--nexus-bg")).toBe(true);
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
