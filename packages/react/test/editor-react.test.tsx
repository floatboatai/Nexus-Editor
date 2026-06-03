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

  it("forwards className, style, and data-* attributes to the container div", () => {
    const { container } = render(
      <Editor
        initialValue="hi"
        className="my-editor"
        style={{ border: "1px solid red" }}
        data-testid="nexus"
        aria-label="Markdown editor"
      />
    );

    const div = container.firstElementChild as HTMLElement;
    expect(div.className).toBe("my-editor");
    expect(div.style.border).toBe("1px solid red");
    expect(div.dataset.testid).toBe("nexus");
    expect(div.getAttribute("aria-label")).toBe("Markdown editor");
  });

  it("fires onReady once with the editor instance", () => {
    const handleReady = vi.fn<(editor: EditorAPI) => void>();

    render(<Editor initialValue="hi" onReady={handleReady} />);

    expect(handleReady).toHaveBeenCalledTimes(1);
    expect(handleReady.mock.calls[0][0].getDocument()).toBe("hi");
  });
});
