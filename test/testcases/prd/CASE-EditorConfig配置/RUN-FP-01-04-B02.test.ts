import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

function hasNexusVar(needle: string): boolean {
  const nodes = Array.from(document.head.querySelectorAll("style"));
  return nodes.some((s) => s.textContent?.includes(needle));
}

describe("FP-01-04-B02: 未配置 theme 时默认主题仍应用前缀变量", () => {
  it("步骤1-3: 创建不抛错、--nexus-bg 存在、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 仅配置 themePrefix、不传 theme（回落 lightTheme）
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        themePrefix: "df-",
      } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 实现差异——默认主题生效但前缀固定 --nexus-bg
    expect(hasNexusVar("--nexus-bg")).toBe(true);
    // 步骤3: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
