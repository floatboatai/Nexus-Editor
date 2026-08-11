import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-06-E02: onFocus 回调抛异常不向上传播（CM6 事务 listener 内部吞异常）", () => {
  it("步骤1: focus() 不抛错", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onFocus: () => {
        throw new Error("focus-boom");
      },
    });

    // 实测：focus() 内部 setFocused 的 config.onFocus 抛错被 CM6 事务
    // 更新监听器捕获（logException），不向上传播
    expect(() => editor.focus()).not.toThrow();

    editor.destroy();
    container.remove();
  });
});
