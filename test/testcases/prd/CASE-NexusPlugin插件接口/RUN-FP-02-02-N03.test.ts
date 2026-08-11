import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-N03: run 返回 false 表示未消费，runShortcut 返回 false", () => {
  it("步骤1-2: runShortcut 原样透传 false，文档未修改", () => {
    const unhandledPlugin: NexusPlugin = {
      name: "unhandled-shortcut",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            return false;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [unhandledPlugin],
    });

    // 步骤1: [API] runShortcut 返回 false（透传）
    expect(editor.runShortcut("Ctrl-k")).toBe(false);
    // 步骤2: [API] 文档未被修改
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
