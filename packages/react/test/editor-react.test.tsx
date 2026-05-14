import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("calls onReady callback when editor is initialized", () => {
    const onReady = vi.fn();

    function Harness() {
      const { containerRef } = useEditor({
        initialValue: "hello",
        onReady
      });

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
      getDocument: expect.any(Function),
      setDocument: expect.any(Function),
      getSelection: expect.any(Function),
      getSelectedText: expect.any(Function),
    }));
  });

  it("onReady callback receives working editor instance", () => {
    let readyDoc = "";

    function Harness() {
      const { containerRef } = useEditor({
        initialValue: "initial content",
        onReady: (editor) => {
          readyDoc = editor.getDocument();
          editor.setDocument("modified by onReady");
        }
      });

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(readyDoc).toBe("initial content");
  });
});
