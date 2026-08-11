import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const docs: string[] = [];
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 100,
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  return { docs, editor };
}

describe("FP-03-02-B03: 防抖期间多轮快速编辑不丢失最终内容", () => {
  it("步骤1-4: 10 次 setDocument 只解析最终 doc-9，文档与 AST 一致", () => {
    const { docs, editor } = setup();
    for (let i = 0; i < 10; i++) {
      editor.setDocument(`doc-${i}`);
    }
    expect(editor.getDocument()).toBe("doc-9");
    expect(docs).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(docs).toEqual(["doc-9"]);

    expect(editor.getDocument()).toBe("doc-9");
    const ast = editor.getAst();
    const para = ast.children[0] as unknown as { type: string; children?: { value?: string }[] };
    expect(para.type).toBe("paragraph");
    expect(para.children?.[0]?.value).toBe("doc-9");
    editor.destroy();
  });
});
