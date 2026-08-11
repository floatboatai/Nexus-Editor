import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-E03: onChange 回调抛异常不向上传播（CM6 update listener 内部吞异常）", () => {
  it("步骤1: setDocument 不抛错且文档已更新", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onChange: () => {
        throw new Error("boom");
      },
    });

    // 实测：emitChange 内 config.onChange 抛错被 CM6 update listener 的
    // logException 捕获（@codemirror/view bindHandler/updateListener 内部 catch），
    // 不向上传播到 setDocument 调用方
    expect(() => editor.setDocument("x")).not.toThrow();
    expect(editor.getDocument()).toBe("x");

    editor.destroy();
    container.remove();
  });
});
