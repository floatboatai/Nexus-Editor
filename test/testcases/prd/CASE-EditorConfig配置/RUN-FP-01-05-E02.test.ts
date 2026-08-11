import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-E02: setDocument 传 { silent: true } 时不触发 onChange", () => {
  it("步骤1-3: calls=0、文档更新、destroy", () => {
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

    // 步骤1: silent 不触发 onChange
    editor.setDocument("silent-update", { silent: true });
    expect(calls).toBe(0);
    // 步骤2: 文档仍更新
    expect(editor.getDocument()).toBe("silent-update");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
