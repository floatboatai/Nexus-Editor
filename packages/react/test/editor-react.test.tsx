import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { Editor, useEditor } from "../src/index";
import type { EditorAPI } from "@floatboat/nexus-core";

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

  it("calls onReady with the editor instance after creation", () => {
    const onReady = vi.fn();

    render(<Editor initialValue="# Ready" onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    const editor: EditorAPI = onReady.mock.calls[0][0];
    expect(editor.getDocument()).toBe("# Ready");
  });

  it("passes className, style, and id to the container div", () => {
    const { container } = render(
      <Editor initialValue="" className="my-editor" style={{ border: "1px solid red" }} id="editor-1" />
    );

    const div = container.firstElementChild as HTMLElement;
    expect(div.className).toContain("my-editor");
    expect(div.style.border).toBe("1px solid red");
    expect(div.id).toBe("editor-1");
  });
});
