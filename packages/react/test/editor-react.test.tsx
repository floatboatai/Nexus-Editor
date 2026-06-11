import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { Editor, useEditor } from "../src/index";

describe("@floatboat/nexus-react", () => {
  it("renders an editor into the provided container through the Editor component", () => {
    const { container, unmount } = render(<Editor initialValue="# Hello" />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector("[contenteditable='true']")).not.toBeNull();

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("exposes the core editor api through useEditor", () => {
    const snapshots: string[] = [];

    function Harness() {
      const { containerRef, editor } = useEditor({ initialValue: "start" });

      useEffect(() => {
        if (!editor) {
          return;
        }

        editor.setDocument("updated");
        snapshots.push(editor.getDocument());
      }, [editor]);

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(snapshots).toContain("updated");
  });

  it("exposes reactive canUndo and canRedo from useEditor", () => {
    const states: Array<{ canUndo: boolean; canRedo: boolean }> = [];

    function Harness() {
      const { containerRef, editor, canUndo, canRedo } = useEditor({
        initialValue: "start",
        plugins: [createHistoryPlugin()],
      });

      useEffect(() => {
        if (!editor) return;

        // 初始状态：无可撤销
        states.push({ canUndo, canRedo });

        editor.setDocument("updated");
      }, [editor]);

      useEffect(() => {
        if (editor) {
          states.push({ canUndo, canRedo });
        }
      }, [canUndo, canRedo]);

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    // 初始状态
    expect(states[0]).toEqual({ canUndo: false, canRedo: false });
    // setDocument 后：canUndo 变为 true
    expect(states[states.length - 1]).toEqual({ canUndo: true, canRedo: false });
  });
});
