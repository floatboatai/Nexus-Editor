import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "[link](https://example.com)\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-N02: 链接节点→data-link-url Widget（隐藏 markdown 语法）", () => {
  it("步骤1-4: Widget 存在、URL 属性值、显示文本、源码隐藏", () => {
    const { container, editor } = setup();
    const el = container.querySelector("[data-link-url]");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-link-url")).toBe("https://example.com");
    expect(el?.textContent).toBe("link");
    expect(container.textContent).not.toContain("[link](https://example.com)");
    const ast = editor.getAst();
    const para = ast.children[0] as unknown as { children?: { type: string }[] };
    expect(para.children?.some((c) => c.type === "link")).toBe(true);
    editor.destroy();
  });
});
