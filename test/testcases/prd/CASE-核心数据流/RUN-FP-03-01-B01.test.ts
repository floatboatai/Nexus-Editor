import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement("div");
  const docs: string[] = [];
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
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  if (!capturedView) throw new Error("Expected CodeMirror view to be captured");
  return { docs, capturedView, editor };
}

describe("FP-03-01-B01: 空文档上首次输入", () => {
  it("步骤1: 初始状态为空文档 + 空 root", () => {
    const { editor } = setup();
    expect(editor.getDocument()).toBe("");
    expect(editor.getAst().type).toBe("root");
    expect(editor.getAst().children).toEqual([]);
    editor.destroy();
  });

  it("步骤2-4: 首次输入触发 onChange 且 AST 生成 paragraph", () => {
    const { capturedView, docs, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" } });
    expect(capturedView.state.doc.toString()).toBe("a");
    expect(docs).toEqual(["a"]);
    const ast = editor.getAst();
    expect(ast.children[0]?.type).toBe("paragraph");
    editor.destroy();
  });
});
