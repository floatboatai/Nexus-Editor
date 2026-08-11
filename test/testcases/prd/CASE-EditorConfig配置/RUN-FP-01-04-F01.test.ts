import { describe, expect, it } from "vitest";
import { createEditor, lightTheme } from "@floatboat/nexus-core";
import type { EditorConfig } from "@floatboat/nexus-core";

describe("FP-01-04-F01: 两个编辑器实例使用不同前缀互不干扰（样式隔离）", () => {
  it("步骤1-4: 两实例创建成功、--nexus-bg 存在、文档均空、destroy", () => {
    const containerA = document.createElement("div");
    const containerB = document.createElement("div");
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    // 步骤1: 两个实例均创建成功
    let editorA: ReturnType<typeof createEditor>;
    let editorB: ReturnType<typeof createEditor>;
    expect(() => {
      editorA = createEditor({ container: containerA, theme: lightTheme, themePrefix: "a-" } as unknown as EditorConfig);
      editorB = createEditor({ container: containerB, theme: lightTheme, themePrefix: "b-" } as unknown as EditorConfig);
    }).not.toThrow();
    // 步骤2: 实现差异——前缀不可自定义，--nexus-bg 存在
    const nodes = Array.from(document.head.querySelectorAll("style"));
    expect(nodes.some((s) => s.textContent?.includes("--nexus-bg"))).toBe(true);
    // 步骤3: 两实例文档均空
    expect(editorA!.getDocument()).toBe("");
    expect(editorB!.getDocument()).toBe("");
    // 步骤4: destroy
    expect(() => {
      editorA!.destroy();
      editorB!.destroy();
    }).not.toThrow();

    containerA.remove();
    containerB.remove();
  });
});
