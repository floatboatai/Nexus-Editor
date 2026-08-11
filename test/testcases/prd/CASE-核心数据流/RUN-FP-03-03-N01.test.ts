import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "# Heading\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-N01: 标题节点→Mark+Replace 装饰（光标移开时隐藏 `# ` 前缀）", () => {
  it("步骤1-4: 标题文本/前缀隐藏/语义属性/AST 数据源", () => {
    const { container, editor } = setup();
    const heading = container.querySelector("[data-heading-level='1']");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Heading");
    expect(container.textContent).not.toContain("# Heading");
    expect(heading?.getAttribute("role")).toBe("heading");
    expect(heading?.getAttribute("aria-level")).toBe("1");
    const ast = editor.getAst();
    expect(ast.children[0]?.type).toBe("heading");
    expect((ast.children[0] as unknown as { depth: number }).depth).toBe(1);
    editor.destroy();
  });
});
