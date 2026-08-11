import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-04-01-N06: fenced code 块光标不在时折叠（fence 透明、role=code）", () => {
  it("步骤1-3: 代码块标记、语言标注、fence 透明", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "before\n\n```js\nconst a = 1;\n```\n\nafter",
      livePreview: true,
    });
    // 光标在末尾：code 块范围 [7,32) 之外 → fence 行透明化
    editor.setSelection(editor.getDocument().length);

    // 步骤1: 代码块标记（role=code 在首行 .cm-line 上）
    expect(container.querySelector("[role='code']")).not.toBeNull();
    // 步骤2: 语言标注
    expect(container.querySelector("[aria-label='Code block: js']")).not.toBeNull();
    // 步骤3: fence 透明
    expect(container.querySelector('[style*="transparent"]')).not.toBeNull();

    editor.destroy();
    container.remove();
  });
});
