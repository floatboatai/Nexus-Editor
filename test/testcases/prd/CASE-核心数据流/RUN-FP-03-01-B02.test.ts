import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  let capturedView: EditorView | null = null;
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        capturedView = view;
      }
    }
  );
  const editor = createEditor({
    container,
    initialValue: "",
    parseDelayMs: 0,
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
  });
  if (!capturedView) throw new Error("Expected CodeMirror view to be captured");
  const bigText = "x".repeat(10_000);
  return { bigText, capturedView, editor };
}

describe("FP-03-01-B02: 超大单次输入（10k 字符）不破坏数据流", () => {
  it("步骤1-3: 一次性插入 10k 字符，文档与 AST 正常", () => {
    const { bigText, capturedView, editor } = setup();
    expect(() => {
      capturedView.dispatch({ changes: { from: 0, insert: bigText }, userEvent: "input.type" });
    }).not.toThrow();
    const doc = editor.getDocument();
    expect(doc.length).toBe(10_000);
    expect(doc.endsWith("x")).toBe(true);
    const ast = editor.getAst();
    expect(ast.type).toBe("root");
    expect(ast.children[0]?.type).toBe("paragraph");
    editor.destroy();
  });

  it("步骤4: 追加字符后文档长度 10_001", () => {
    const { bigText, capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: bigText }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: capturedView.state.doc.length, insert: "y" }, userEvent: "input.type" });
    const doc = editor.getDocument();
    expect(doc.length).toBe(10_001);
    expect(doc.endsWith("y")).toBe(true);
    editor.destroy();
  });
});
