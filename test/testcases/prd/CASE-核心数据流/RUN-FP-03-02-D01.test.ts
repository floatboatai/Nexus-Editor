import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "mdast";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const docs: string[] = [];
  const asts: Root[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string, ast: Root) => {
      docs.push(doc);
      asts.push(ast);
    },
  });
  return { asts, docs, editor };
}

describe("FP-03-02-D01: 防抖后 onChange 的 AST 与最新文档一致", () => {
  it("步骤1-4: 两次 setDocument 合并后 AST 对应最新文档 '# Two'", () => {
    const { asts, docs, editor } = setup();
    editor.setDocument("# One");
    editor.setDocument("# Two");
    expect(editor.getDocument()).toBe("# Two");

    vi.advanceTimersByTime(100);
    expect(docs).toEqual(["# Two"]);

    const ast = asts[0];
    expect(ast.children[0]?.type).toBe("heading");
    const heading = ast.children[0] as unknown as { depth: number };
    expect(heading.depth).toBe(1);

    const current = editor.getAst();
    expect(current.children[0]?.type).toBe("heading");
    editor.destroy();
  });
});
