import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "mdast";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  let lastAst: Root | null = null;
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    onChange: (_doc: string, ast: Root) => {
      lastAst = ast;
    },
  });
  return { editor, getLastAst: () => lastAst };
}

describe("FP-03-04-N02: getAst() 与 onChange 收到的 AST 为同一实例", () => {
  it("步骤1-3: 两次变更后 getAst() === lastAst 均成立", () => {
    const { editor, getLastAst } = setup();
    editor.setDocument("hello world");
    expect(editor.getAst()).toBe(getLastAst());

    editor.setDocument("changed");
    expect(editor.getAst()).toBe(getLastAst());
    editor.destroy();
  });
});
