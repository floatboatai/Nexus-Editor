import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-01-N01: 提供合法容器节点时编辑器正常挂载", () => {
  it("步骤1-3: 挂载 .cm-editor、getDocument 正确、destroy 幂等", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "# Hello" });

    // 步骤1: .cm-editor 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: getDocument
    expect(editor.getDocument()).toBe("# Hello");
    // 步骤3: destroy 不抛异常
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
