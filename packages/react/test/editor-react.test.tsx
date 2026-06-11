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

  it("calls onReady callback after editor initialization", () => {
    const onReady = vi.fn();
    const { unmount } = render(
      <Editor initialValue="ready" onReady={onReady} />
    );

    expect(onReady).toHaveBeenCalledOnce();
    const api = onReady.mock.calls[0][0] as EditorAPI;
    expect(api.getDocument()).toBe("ready");
    unmount();
  });

  it("applies className and style to the container div", () => {
    const { container, unmount } = render(
      <Editor
        initialValue="styled"
        className="my-editor"
        style={{ height: "400px", border: "1px solid red" }}
      />
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("my-editor");
    expect(wrapper.style.height).toBe("400px");
    expect(wrapper.style.border).toBe("1px solid red");
    unmount();
  });
});
