import type { EditorAPI } from "@floatboat/nexus-core";
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

  it("calls onReady with a usable EditorAPI instance", () => {
    let ready: EditorAPI | null = null;

    render(
      <Editor
        initialValue="start"
        onReady={(editor) => {
          ready = editor;
          editor.setDocument("ready");
        }}
      />
    );

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).toBe("ready");
  });

  it("passes className to the wrapper div", () => {
    const { container } = render(<Editor className="host" />);

    expect(container.querySelector(".host")).not.toBeNull();
  });

  it("calls onReady from useEditor on first mount", () => {
    let ready: EditorAPI | null = null;

    function Harness() {
      const { containerRef } = useEditor({
        initialValue: "hook",
        onReady: (editor) => {
          ready = editor;
        }
      });

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).toBe("hook");
  });
});
