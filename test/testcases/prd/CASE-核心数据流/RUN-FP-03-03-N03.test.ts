import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "- item\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-N03: 列表节点→bullet Widget（`- ` marker 替换为圆点）", () => {
  it("步骤1-4: 圆点渲染、内容保留、marker 隐藏、AST list", () => {
    const { container, editor } = setup();
    expect(container.textContent).toContain("•");
    expect(container.textContent).toContain("item");
    expect(container.textContent).not.toContain("- item");
    const list = editor.getAst().children[0] as unknown as { type: string; ordered: boolean };
    expect(list.type).toBe("list");
    expect(list.ordered).toBe(false);
    editor.destroy();
  });
});
