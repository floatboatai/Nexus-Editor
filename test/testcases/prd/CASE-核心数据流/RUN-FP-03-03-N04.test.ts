import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold** *italic*\n\nend",
    livePreview: true,
    parseDelayMs: 0,
  });
  editor.setSelection(editor.getDocument().length);
  return { container, editor };
}

describe("FP-03-03-N04: 行内 strong/emphasis→样式 Mark（隐藏 `**`/`*` marker）", () => {
  it("步骤1-4: 文本保留、marker 隐藏、AST strong/emphasis", () => {
    const { container, editor } = setup();
    expect(container.textContent).toContain("bold");
    expect(container.textContent).toContain("italic");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("*italic*");
    const para = editor.getAst().children[0] as unknown as { children?: { type: string }[] };
    const types = (para.children ?? []).map((c) => c.type);
    expect(types).toContain("strong");
    expect(types).toContain("emphasis");
    editor.destroy();
  });
});
