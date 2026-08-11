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

describe("FP-03-01-D01: 输入后 AST 与文档内容保持一致（heading 解析）", () => {
  it("步骤1-3: 输入标题后 AST 为 heading depth 1，位置 offset 0", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "# Title\n" }, userEvent: "input.type" });
    expect(capturedView.state.doc.toString()).toBe("# Title\n");
    const ast = editor.getAst();
    const heading = ast.children[0] as unknown as {
      type: string;
      depth: number;
      position?: { start?: { offset?: number } };
    };
    expect(heading.type).toBe("heading");
    expect(heading.depth).toBe(1);
    expect(heading.position?.start?.offset).toBe(0);
    editor.destroy();
  });

  it("步骤4: 追加 body 后 children 变为 [heading, paragraph]", () => {
    const { capturedView, editor } = setup();
    capturedView.dispatch({ changes: { from: 0, insert: "# Title\n" }, userEvent: "input.type" });
    capturedView.dispatch({ changes: { from: 8, insert: "body" }, userEvent: "input.type" });
    const ast = editor.getAst();
    const types = ast.children.map((c) => c.type);
    expect(types).toEqual(["heading", "paragraph"]);
    editor.destroy();
  });
});
