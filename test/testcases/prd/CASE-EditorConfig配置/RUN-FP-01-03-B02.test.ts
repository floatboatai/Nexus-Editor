import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-03-B02: plugins 为空数组时编辑器正常创建", () => {
  it("步骤1-4: 创建不抛错、挂载、slashCommands 空、destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 空数组创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({ container, plugins: [] });
    }).not.toThrow();
    // 步骤2: 挂载
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    // 步骤3: 无插件命令
    expect(editor!.getSlashCommands().length).toBe(0);
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
