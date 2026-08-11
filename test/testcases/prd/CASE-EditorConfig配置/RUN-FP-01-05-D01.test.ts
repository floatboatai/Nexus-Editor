import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-D01: 创建时不触发 onChange（避免误报初始加载）", () => {
  it("步骤1-3: calls=0、getDocument=initial、destroy", () => {
    let calls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "initial",
      onChange: () => {
        calls += 1;
      },
    });

    // 步骤1: 初始加载不触发
    expect(calls).toBe(0);
    // 步骤2: 文档正确
    expect(editor.getDocument()).toBe("initial");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
