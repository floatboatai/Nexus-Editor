import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-E01: setDocument 默认触发一次 onChange", () => {
  it("步骤1-3: calls=1、getDocument=b、destroy", () => {
    let calls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "a",
      onChange: () => {
        calls += 1;
      },
    });

    // 步骤1: setDocument 触发一次 onChange
    editor.setDocument("b");
    expect(calls).toBe(1);
    // 步骤2: 文档为 b
    expect(editor.getDocument()).toBe("b");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
