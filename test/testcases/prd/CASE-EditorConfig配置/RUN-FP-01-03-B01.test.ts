import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-03-B01: plugins 缺省时编辑器正常创建且内置能力可用", () => {
  it("步骤1-4: 创建不抛错、挂载、文档、slashCommands 空、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 不传 plugins 创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({ container, initialValue: "# Hi" });
    }).not.toThrow();
    // 步骤2: 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤3: 文档与 slashCommands
    expect(editor!.getDocument()).toBe("# Hi");
    expect(editor!.getSlashCommands().length).toBe(0);
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
