import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const md = "```js\nconst a = 1;\nconst b = 2;\n```\n\nend";
  const editor = createEditor({
    container,
    initialValue: md,
    livePreview: true,
  });
  return { container, editor, md };
}

describe("FP-05-03-D01: AST 数据层完整：code 节点保留原始 lang 与 value", () => {
  it("步骤1-4: getAst 含 lang=js 的 code 节点、value 完整保留", () => {
    const { container, editor, md } = setup();
    editor.setSelection(editor.getDocument().length);

    const ast = editor.getAst() as { children?: Array<Record<string, unknown>> };
    const codeNodes = (ast.children ?? []).filter((n) => n.type === "code");
    expect(codeNodes.length).toBe(1);
    expect(codeNodes[0].lang).toBe("js");
    expect(codeNodes[0].value).toBe("const a = 1;\nconst b = 2;");
    editor.destroy();
  });
});
