import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn();
  const editor = createEditor({
    container,
    // 初始必须非空：若初始为空且 setDocument("") 内容无变化，
    // CM6 不产生 docChanged，onChange 不会触发（"无变化不通知"标准语义）
    initialValue: "hello world",
    parseDelayMs: 0,
    onChange,
  });
  return { onChange, editor };
}

describe("FP-03-04-B01: 空文档 setDocument 触发 onChange 且 AST 为空 root", () => {
  it("步骤1-3: setDocument('') 触发 onChange、AST 为空 root、文档为空", () => {
    const { onChange, editor } = setup();
    editor.setDocument("");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("");
    const ast = onChange.mock.calls[0][1] as { type: string; children: unknown[] };
    expect(ast.type).toBe("root");
    expect(ast.children).toEqual([]);
    expect(editor.getDocument()).toBe("");
    expect(editor.getAst().children).toEqual([]);
    editor.destroy();
  });
});
