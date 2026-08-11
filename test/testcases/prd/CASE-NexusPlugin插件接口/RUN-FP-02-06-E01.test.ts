import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

describe("FP-02-06-E01: cmExtensions 中非法 extension 导致编辑器创建失败", () => {
  it("步骤1-2: createEditor 抛出异常，无半初始化实例", () => {
    const brokenPlugin: NexusPlugin = {
      name: "broken-extension",
      cmExtensions: [null as any],
    };

    const container = document.createElement("div");
    // 步骤1: [STATE] 捕获异常
    let editor: ReturnType<typeof createEditor> | null = null;
    let caught: unknown = null;
    try {
      editor = createEditor({
        container,
        initialValue: "start",
        plugins: [brokenPlugin],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    // 步骤2: [STATE] 无半初始化实例
    expect(editor).toBeNull();
  });
});
