import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

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
    plugins: [
      { name: "capture-view", cmExtensions: [captureView] },
      createHistoryPlugin(),
    ],
  });
  if (!capturedView) throw new Error("Expected CodeMirror view to be captured");
  return { capturedView, editor };
}

describe("FP-03-01-F02: 多步编辑后沿 Transaction 历史 undo/redo 回退", () => {
  it("步骤1-5: 输入→setDocument→undo→undo→redo 全链路", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    expect(editor.getDocument()).toBe("a");

    editor.setDocument("ab");
    expect(editor.getDocument()).toBe("ab");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");

    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("a");
    editor.destroy();
  });
});
