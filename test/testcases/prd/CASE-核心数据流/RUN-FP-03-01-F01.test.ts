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
  return { capturedView, editor };
}

describe("FP-03-01-F01: 输入→移动光标→继续输入的编辑流程（选区随 Transaction 更新）", () => {
  it("步骤1-3: 输入+setSelection+再输入，文档与选区同步", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({
      changes: { from: 0, insert: "Hello" },
      selection: { anchor: 5 },
      userEvent: "input.type",
    });
    editor.setSelection(0);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    capturedView.dispatch({
      changes: { from: 0, insert: "World" },
      selection: { anchor: 5 },
      userEvent: "input.type",
    });
    expect(editor.getDocument()).toBe("WorldHello");
    expect(editor.getSelection()).toEqual({ anchor: 5, head: 5 });
    editor.destroy();
  });

  it("步骤5: 文档仍为单行", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({
      changes: { from: 0, insert: "Hello" },
      selection: { anchor: 5 },
      userEvent: "input.type",
    });
    editor.setSelection(0);
    capturedView.dispatch({
      changes: { from: 0, insert: "World" },
      selection: { anchor: 5 },
      userEvent: "input.type",
    });
    expect(capturedView.state.doc.lines).toBe(1);
    editor.destroy();
  });
});
