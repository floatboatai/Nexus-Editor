import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("fires onReady once with the live editor api", () => {
    const onReady = vi.fn<(editor: EditorAPI) => void>();

    const { rerender } = render(<Editor initialValue="# Hi" onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].getDocument()).toBe("# Hi");

    // A parent re-render must not recreate the editor or refire the callback.
    rerender(<Editor initialValue="# Hi" onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("forwards containerProps onto the root element", () => {
    const { container } = render(
      <Editor
        initialValue="x"
        containerProps={{ className: "host-shell", id: "nexus-root", "data-testid": "shell" }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root.classList.contains("host-shell")).toBe(true);
    expect(root.id).toBe("nexus-root");
    expect(root.getAttribute("data-testid")).toBe("shell");
    expect(root.querySelector(".cm-editor")).not.toBeNull();
  });
});
