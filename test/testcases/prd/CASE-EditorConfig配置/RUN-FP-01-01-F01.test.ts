import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-01-F01: 容器已有子内容时编辑器追加挂载且不覆盖原内容", () => {
  it("步骤1-4: 原子节点保留、cm-editor 追加、文档正确、destroy", () => {
    const container = document.createElement("div");
    const existing = document.createElement("span");
    existing.textContent = "existing-content";
    existing.className = "pre-existing";
    container.appendChild(existing);
    document.body.appendChild(container);

    const editor = createEditor({ container, initialValue: "# Title" });

    // 步骤1: 原节点与 .cm-editor 并存
    expect(container.querySelector(".pre-existing")).not.toBeNull();
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤2: 原节点内容未被覆盖
    expect(container.querySelector(".pre-existing")?.textContent).toBe("existing-content");
    // 步骤3: 文档
    expect(editor.getDocument()).toBe("# Title");
    // 步骤4: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
