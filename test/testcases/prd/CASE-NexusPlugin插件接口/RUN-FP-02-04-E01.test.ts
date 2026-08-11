import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import type { Plugin } from "unified";
import type { Root } from "mdast";

describe("FP-02-04-E01: remark 插件在转换时抛出异常导致 createEditor 失败", () => {
  it("步骤1-2: createEditor 抛错，无半初始化实例", () => {
    const brokenTransform: Plugin<[], Root, Root> = function () {
      return () => {
        throw new Error("TEST_remark_plugin_broken");
      };
    };

    const brokenPlugin: NexusPlugin = {
      name: "broken-remark",
      remarkPlugins: [brokenTransform],
    };

    const container = document.createElement("div");
    // 步骤1: [STATE] createEditor 抛出异常
    let editor: ReturnType<typeof createEditor> | null = null;
    expect(() => {
      editor = createEditor({
        container,
        initialValue: "# Heading",
        plugins: [brokenPlugin],
      });
    }).toThrow("TEST_remark_plugin_broken");
    // 步骤2: [STATE] 无半初始化实例
    expect(editor).toBeNull();
  });
});
