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

describe("FP-03-01-N02: 连续多次输入各自形成 Transaction 且每次同步反映到文档", () => {
  it("步骤1-2: 三次 dispatch 各自独立 Transaction，文档为 abc", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 2, insert: "c" }, userEvent: "input.type" });
    expect(editor.getDocument()).toBe("abc");
    editor.destroy();
  });

  it("步骤3: 每次输入各触发一次 onChange，docs 顺序对应", () => {
    const { capturedView, docs } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 2, insert: "c" }, userEvent: "input.type" });
    expect(docs).toEqual(["a", "ab", "abc"]);
  });

  it("步骤4: AST paragraph 文本为 abc，与文档一致", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 2, insert: "c" }, userEvent: "input.type" });
    const ast = editor.getAst();
    const para = ast.children[0] as unknown as { type: string; children?: { value?: string }[] };
    expect(para.type).toBe("paragraph");
    expect(para.children?.[0]?.value).toBe("abc");
    editor.destroy();
  });
});
