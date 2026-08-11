import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-01-N02: 挂载到已加入 document 的节点时全局可查", () => {
  it("步骤1-3: document 可查、空文档、destroy 幂等", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container });

    // 步骤1: 全局可查
    expect(document.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: initialValue 缺省回落空串
    expect(editor.getDocument()).toBe("");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
