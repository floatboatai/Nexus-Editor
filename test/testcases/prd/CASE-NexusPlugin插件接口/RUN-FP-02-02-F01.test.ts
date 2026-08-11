import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-F01: 快捷键修改文档后 onChange 回调触发（流程）", () => {
  it("步骤1-2: runShortcut 返回 true，onChange 收到新文档", () => {
    const docs: string[] = [];
    const flowPlugin: NexusPlugin = {
      name: "flow-plugin",
      shortcuts: [
        {
          key: "Ctrl-k",
          run(api) {
            api.setDocument("after-shortcut");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [flowPlugin],
      onChange(doc) {
        docs.push(doc);
      },
    });

    // 步骤1: [API] 返回 true
    expect(editor.runShortcut("Ctrl-k")).toBe(true);
    // 步骤2: [EVENT] onChange 被触发并收到新文档
    expect(docs).toContain("after-shortcut");

    editor.destroy();
  });
});
