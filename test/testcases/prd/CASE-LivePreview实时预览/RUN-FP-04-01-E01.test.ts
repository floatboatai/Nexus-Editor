import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async (id: string) => ({ svg: `<svg data-id="${id}"></svg>` })),
  },
}));

describe("FP-04-01-E01: mermaid 块懒加载折叠为 .nexus-mermaid Widget 且源码隐藏", () => {
  it("步骤1-4: Widget 挂载、源码隐藏、编辑按钮、异步渲染 svg", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const md = ["before", "", "```mermaid", "graph TD", "  A --> B", "```", "", "after"].join("\n");
    const editor = createEditor({
      container,
      initialValue: md,
      livePreview: true,
    });
    // 光标在末尾：mermaid 块之外 → 懒加载折叠为 diagram Widget
    editor.setSelection(md.length);

    // 步骤1: mermaid Widget
    expect(container.querySelector(".nexus-mermaid")).not.toBeNull();
    // 步骤2: 源码隐藏
    const text = container.textContent ?? "";
    expect(text).not.toContain("graph TD");
    expect(text).not.toContain("```mermaid");
    // 步骤3: 编辑按钮
    expect(
      container.querySelector('.nexus-mermaid button[aria-label="Edit mermaid source"]')
    ).not.toBeNull();
    // 步骤4: 异步渲染 svg（mermaid render Promise）
    await vi.waitFor(() => {
      expect(container.querySelector(".nexus-mermaid svg")).not.toBeNull();
    });

    editor.destroy();
    container.remove();
  });
});
