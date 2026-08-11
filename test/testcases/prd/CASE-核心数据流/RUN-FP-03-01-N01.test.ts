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
    parseDelayMs: 0, // 显式关闭防抖，验证"输入即更新"的同步链路
    plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
    onChange: (doc: string) => {
      docs.push(doc);
    },
  });
  if (!capturedView) throw new Error("Expected CodeMirror view to be captured");
  return { container, docs, capturedView, editor };
}

describe("FP-03-01-N01: 用户键入字符经 CM6 Transaction 更新 EditorState 与文档", () => {
  it("步骤1-3: dispatch 同步应用到 doc，getDocument 与 EditorState 一致", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    expect(capturedView.state.doc.toString()).toBe("a");
    expect(editor.getDocument()).toBe("a");
    editor.destroy();
  });

  it("步骤4: onChange 同步触发 1 次，参数为 'a'", () => {
    const { capturedView, docs } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    expect(docs).toEqual(["a"]);
  });

  it("步骤5: AST 为 root 且首子节点为 paragraph", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    const ast = editor.getAst();
    expect(ast.type).toBe("root");
    expect(ast.children[0]?.type).toBe("paragraph");
    editor.destroy();
  });
});
