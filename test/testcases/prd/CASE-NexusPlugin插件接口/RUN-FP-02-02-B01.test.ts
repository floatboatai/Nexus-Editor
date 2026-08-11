import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-02-B01: 多个插件注册相同 key，先注册者生效", () => {
  it("步骤1-2: runShortcut 命中先注册者，后注册者不执行", () => {
    const firstRan: string[] = [];
    const pluginFirst: NexusPlugin = {
      name: "first",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            firstRan.push("first");
            return true;
          },
        },
      ],
    };
    const pluginSecond: NexusPlugin = {
      name: "second",
      shortcuts: [
        {
          key: "Ctrl-k",
          run() {
            firstRan.push("second");
            return true;
          },
        },
      ],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [pluginFirst, pluginSecond],
    });

    // 步骤1: [API] 返回 true
    expect(editor.runShortcut("Ctrl-k")).toBe(true);
    // 步骤2: [STATE] 只有先注册者执行
    expect(firstRan).toEqual(["first"]);

    editor.destroy();
  });
});
