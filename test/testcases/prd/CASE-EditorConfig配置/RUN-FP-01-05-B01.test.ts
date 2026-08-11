import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-B01: 连续多次 setDocument 每次均触发一次 onChange", () => {
  it("步骤1-3: calls=3、getDocument=c、destroy", () => {
    let calls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onChange: () => {
        calls += 1;
      },
    });

    // 步骤1: 三次 setDocument 各触发一次
    editor.setDocument("a");
    editor.setDocument("b");
    editor.setDocument("c");
    expect(calls).toBe(3);
    // 步骤2: 最终文档
    expect(editor.getDocument()).toBe("c");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
