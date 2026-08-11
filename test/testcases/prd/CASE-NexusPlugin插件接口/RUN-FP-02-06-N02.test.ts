import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { ViewPlugin, EditorView } from "@codemirror/view";

describe("FP-02-06-N02: cmExtensions 中 ViewPlugin 实例化并可访问编辑器状态", () => {
  it("步骤1-2: ViewPlugin 实例化，捕获的 view 可读文档", () => {
    let capturedView: EditorView | null = null;
    const captureViewPlugin = ViewPlugin.define((view) => {
      capturedView = view;
      return {};
    });

    const viewPlugin: NexusPlugin = {
      name: "view-plugin",
      cmExtensions: [captureViewPlugin],
    };

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [viewPlugin],
    });

    // 步骤1: [STATE] ViewPlugin 已实例化
    expect(capturedView).not.toBeNull();
    // 步骤2: [STATE] 读取文档
    expect(capturedView?.state.doc.toString()).toBe("start");

    editor.destroy();
  });
});
