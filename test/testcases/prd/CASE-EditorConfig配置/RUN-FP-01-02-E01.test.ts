import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import type { Root } from "mdast";

describe("FP-01-02-E01: 非法 Markdown（未闭合代码块）容错解析不抛错", () => {
  it("步骤1-4: 创建不抛错、原文保留、AST root、destroy", () => {
    const broken = "```js\nconsole.log(1)\n";
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 步骤1: 未闭合代码块创建不抛异常
    let editor: ReturnType<typeof createEditor>;
    expect(() => {
      editor = createEditor({ container, initialValue: broken });
    }).not.toThrow();
    // 步骤2: 原文完整保留
    expect(editor!.getDocument()).toBe(broken);
    // 步骤3: AST 返回有效 root
    expect((editor!.getAst() as Root).type).toBe("root");
    // 步骤4: destroy
    expect(() => editor!.destroy()).not.toThrow();

    container.remove();
  });
});
