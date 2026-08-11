import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

describe("FP-01-05-N01: onChange 在文档变化时被调用且参数为最新文档", () => {
  it("步骤1-3: 创建不触发、setDocument 后 docs=[next]、destroy", () => {
    const docs: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      onChange: (doc) => {
        docs.push(doc);
      },
    });

    // 步骤1: 初始创建不触发
    expect(docs).toHaveLength(0);
    // 步骤2: setDocument 触发一次，载荷为 next
    editor.setDocument("next");
    expect(docs).toEqual(["next"]);
    // 步骤3: destroy
    expect(() => editor.destroy()).not.toThrow();

    container.remove();
  });
});
