import { describe, expect, it } from "vitest";
import { createEditor, lightTheme } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

function hasNexusVar(needle: string): boolean {
  const nodes = Array.from(document.head.querySelectorAll("style"));
  return nodes.some((s) => s.textContent?.includes(needle));
}

describe("FP-01-04-B01: themePrefix 为空字符串时回落默认 'nx-'", () => {
  it("步骤1-3: 创建不抛错、样式含 --nexus-bg、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 空字符串 themePrefix 不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        theme: lightTheme,
        themePrefix: "",
      } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 实现差异——固定前缀 --nexus-bg
    expect(hasNexusVar("--nexus-bg")).toBe(true);
    // 步骤3: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
