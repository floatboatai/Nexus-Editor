import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-06-B01: 空 cmExtensions 数组安全注册", () => {
  it("步骤1-2: 创建不抛错，文档正常", () => {
    const emptyPlugin: NexusPlugin = {
      name: "empty-extension",
      cmExtensions: [],
    };

    const container = document.createElement("div");
    // 步骤1: [STATE] 创建不抛错
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "start",
        plugins: [emptyPlugin],
      });
    }).not.toThrow();
    editor = createEditor({
      container,
      initialValue: "start",
      plugins: [emptyPlugin],
    });
    // 步骤2: [API] 文档正常
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
