import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
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

  it("passes container props through to the wrapper element", () => {
    const { container, unmount } = render(
      <Editor
        initialValue="# Hello"
        className="my-editor"
        style={{ minHeight: 320 }}
        data-testid="note-editor"
      />
    );

    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper?.className).toContain("my-editor");
    expect(wrapper?.getAttribute("data-testid")).toBe("note-editor");
    expect(wrapper?.style.minHeight).toBe("320px");
    expect(wrapper?.querySelector(".cm-editor")).not.toBeNull();

    unmount();
  });

  it("calls onReady once with the editor api", () => {
    const readyDocuments: string[] = [];

    const { unmount } = render(
      <Editor
        initialValue="ready-check"
        onReady={(editor) => {
          readyDocuments.push(editor.getDocument());
        }}
      />
    );

    expect(readyDocuments).toEqual(["ready-check"]);

    unmount();
  });

  it("calls onReady from useEditor without going through Editor", () => {
    const readyDocuments: string[] = [];

    function Harness() {
      const { containerRef } = useEditor({
        initialValue: "hook-ready",
        onReady: (editor) => {
          readyDocuments.push(editor.getDocument());
        }
      });

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(readyDocuments).toEqual(["hook-ready"]);
  });

  it("does not call onReady again when Editor props change", () => {
    let readyCount = 0;

    const { rerender } = render(
      <Editor initialValue="first" onReady={() => readyCount++} />
    );

    expect(readyCount).toBe(1);

    rerender(<Editor initialValue="second" onReady={() => readyCount++} />);

    expect(readyCount).toBe(1);
  });

  it("does not pass editor config props to the wrapper element", () => {
    const onReady = () => {};
    const onChange = () => {};

    const { container, unmount } = render(
      <Editor
        initialValue="# Hello"
        readOnly
        onReady={onReady}
        onChange={onChange}
        className="my-editor"
      />
    );

    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper?.className).toContain("my-editor");
    expect(wrapper?.hasAttribute("initialValue")).toBe(false);
    expect(wrapper?.hasAttribute("readOnly")).toBe(false);
    expect(wrapper?.hasAttribute("onReady")).toBe(false);
    expect(wrapper?.hasAttribute("onChange")).toBe(false);

    unmount();
  });

  it("forwards readOnly to the underlying editor", () => {
    const { container, unmount } = render(<Editor initialValue="# Hello" readOnly />);

    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("false");

    unmount();
  });
});
