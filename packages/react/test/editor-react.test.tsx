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

  it("fires onReady with the editor instance", () => {
    const readySpy = vi.fn();
    render(<Editor initialValue="hello" onReady={readySpy} />);

    expect(readySpy).toHaveBeenCalledTimes(1);
    const receivedEditor: EditorAPI = readySpy.mock.calls[0][0];
    expect(receivedEditor.getDocument()).toBe("hello");
  });

  it("forwards className to the container div", () => {
    const { container } = render(<Editor initialValue="test" className="my-editor" />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe("my-editor");
  });

  it("forwards id to the container div", () => {
    const { container } = render(<Editor initialValue="test" id="editor-main" />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.id).toBe("editor-main");
  });
});
