import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import type { EditorAPI } from "@floatboat/nexus-core";
import { Editor, useEditor } from "../src/index";

describe("@floatboat/nexus-react", () => {
  it("renders an editor into the provided container through the Editor component", () => {
    const { container, unmount } = render(<Editor initialValue="# Hello" />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector("[contenteditable='true']")).not.toBeNull();

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("passes container props through and calls onReady with the core editor", () => {
    const readyEditors: EditorAPI[] = [];
    const { container, unmount } = render(
      <Editor
        initialValue="# Ready"
        id="nexus-react-editor"
        className="editor-shell"
        data-testid="editor-host"
        aria-label="Markdown editor"
        onReady={(editor) => readyEditors.push(editor)}
      />
    );

    const host = container.querySelector<HTMLElement>("[data-testid='editor-host']");

    expect(host).not.toBeNull();
    expect(host?.id).toBe("nexus-react-editor");
    expect(host?.classList.contains("editor-shell")).toBe(true);
    expect(host?.getAttribute("aria-label")).toBe("Markdown editor");
    expect(host?.querySelector(".cm-editor")).not.toBeNull();
    expect(readyEditors).toHaveLength(1);
    expect(readyEditors[0]?.getDocument()).toBe("# Ready");

    unmount();
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

  it("calls onReady from useEditor when the editor is mounted", () => {
    const readyDocs: string[] = [];

    function Harness() {
      const { containerRef } = useEditor({
        initialValue: "hook-ready",
        onReady(editor) {
          readyDocs.push(editor.getDocument());
        }
      });

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    expect(readyDocs).toEqual(["hook-ready"]);
  });
});
