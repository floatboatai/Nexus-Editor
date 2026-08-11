import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "mdast";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const onChange = vi.fn((_doc: string, _ast: Root) => {});
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange,
  });
  return { onChange, editor };
}

describe("FP-03-04-N01: onChange(doc, ast) 参数与文档及 AST 一致", () => {
  it("步骤1-4: setDocument 后双参数正确，且与 getDocument/getAst 一致", () => {
    const { onChange, editor } = setup();
    editor.setDocument("# Hello");
    expect(onChange).toHaveBeenCalledTimes(1);

    const call = onChange.mock.calls[0] as [string, Root];
    expect(call[0]).toBe("# Hello");
    expect(call[1].type).toBe("root");
    const heading = call[1].children[0] as unknown as { type: string; depth: number };
    expect(heading.type).toBe("heading");
    expect(heading.depth).toBe(1);

    expect(editor.getDocument()).toBe("# Hello");
    expect(editor.getAst().children[0]?.type).toBe("heading");
    editor.destroy();
  });
});
