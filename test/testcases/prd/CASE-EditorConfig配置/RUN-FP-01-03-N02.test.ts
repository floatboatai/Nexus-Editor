import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-03-N02: 插件 shortcuts 注册后快捷键生效", () => {
  it("步骤1-3: runShortcut 执行 replaceSelection、文档为 X", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [
        {
          name: "shortcut-demo",
          shortcuts: [
            {
              key: "Ctrl-j",
              run: (api) => {
                api.replaceSelection("X");
                return true;
              },
            },
          ],
        },
      ],
    });

    // 步骤1: runShortcut 触发
    const result = editor.runShortcut("Ctrl-j");
    expect(result).toBe(true);
    // 步骤2: 文档为 X
    expect(editor.getDocument()).toBe("X");
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
