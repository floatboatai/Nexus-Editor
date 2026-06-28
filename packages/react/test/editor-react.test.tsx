import type { EditorAPI } from "@floatboat/nexus-core";
import { render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
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

  it("uses value as the initial document when controlled", async () => {
    function Harness() {
      const { containerRef, editor } = useEditor({ value: "controlled-start" });
      return (
        <div ref={containerRef} data-doc={editor?.getDocument() ?? ""} />
      );
    }

    const { container } = render(<Harness />);

    await waitFor(() => {
      expect(container.querySelector("[data-doc]")?.getAttribute("data-doc")).toBe(
        "controlled-start"
      );
    });
  });

  it("syncs the editor when the controlled value prop changes", async () => {
    function Harness({ value }: { value: string }) {
      const { containerRef, editor } = useEditor({ value, onChange: () => {} });
      return (
        <div ref={containerRef} data-doc={editor?.getDocument() ?? ""} />
      );
    }

    const { container, rerender } = render(<Harness value="first" />);

    await waitFor(() => {
      expect(container.querySelector("[data-doc]")?.getAttribute("data-doc")).toBe("first");
    });

    rerender(<Harness value="second" />);

    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("second");
    });
  });

  it("forwards document changes to onChange in controlled mode", async () => {
    const onChange = vi.fn();

    function Harness() {
      const { containerRef, editor } = useEditor({
        value: "start",
        onChange
      });

      useEffect(() => {
        if (!editor) {
          return;
        }

        editor.setDocument("edited");
      }, [editor]);

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe("edited");
    });
  });

  it("skips silent setDocument when controlled value already matches the last change", async () => {
    const silentDocs: string[] = [];

    function Harness() {
      const [value, setValue] = useState("alpha");
      const { containerRef, editor } = useEditor({
        value,
        onChange: (doc) => setValue(doc)
      });

      useEffect(() => {
        if (!editor) {
          return;
        }

        const original = editor.setDocument.bind(editor);
        editor.setDocument = (next, opts) => {
          if (opts?.silent === true) {
            silentDocs.push(next);
          }
          return original(next, opts);
        };

        editor.setDocument("beta");
      }, [editor]);

      return <div ref={containerRef} />;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(silentDocs.filter((doc) => doc === "beta")).toHaveLength(0);
    });
  });

  it("Editor component syncs when the value prop changes", async () => {
    const { container, rerender } = render(
      <Editor value="one" onChange={() => {}} plugins={[]} />
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("one");
    });

    rerender(<Editor value="two" onChange={() => {}} plugins={[]} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("two");
    });
  });

  it("applies rapid external value updates without leaving stale content", async () => {
    function Harness({ value }: { value: string }) {
      const { containerRef } = useEditor({ value, onChange: () => {} });
      return <div ref={containerRef} />;
    }

    const { container, rerender } = render(<Harness value="v1" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("v1");
    });

    rerender(<Harness value="v2" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("v2");
    });

    rerender(<Harness value="v3" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("v3");
    });
  });

  it("supports readOnly together with a controlled value", async () => {
    const { container } = render(
      <Editor value="# Locked" readOnly onChange={() => {}} />
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-line")?.textContent).toBe("# Locked");
    });

    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe(
      "false"
    );
  });

  it("forwards multiCursor to createEditor, enabling multi-selection", async () => {
    let ready: EditorAPI | null = null;

    const { container } = render(
      <Editor
        initialValue="hello world"
        multiCursor
        onReady={(editor) => {
          ready = editor;
        }}
      />
    );

    await waitFor(() => {
      expect(ready).not.toBeNull();
    });

    ready!.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    const { ranges } = ready!.getSelections();
    expect(ranges).toHaveLength(2);
    expect(ranges).toEqual([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    // multiCursor must NOT leak into the DOM — it was destructured
    // out of divProps and forwarded to useEditor().
    const editorContainer = container.querySelector(".cm-editor")?.parentElement;
    expect(editorContainer?.hasAttribute("multiCursor")).toBe(false);

    ready!.destroy();
  });

  it("uses single-selection by default when multiCursor is omitted", async () => {
    let ready: EditorAPI | null = null;

    render(
      <Editor
        initialValue="hello world"
        onReady={(editor) => {
          ready = editor;
        }}
      />
    );

    await waitFor(() => {
      expect(ready).not.toBeNull();
    });

    ready!.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    const { ranges } = ready!.getSelections();
    expect(ranges).toHaveLength(1);

    ready!.destroy();
  });

  it("keeps initialValue behavior in uncontrolled mode", async () => {
    function Harness() {
      const { containerRef, editor } = useEditor({ initialValue: "uncontrolled" });
      return (
        <div ref={containerRef} data-doc={editor?.getDocument() ?? ""} />
      );
    }

    const { container } = render(<Harness />);

    await waitFor(() => {
      expect(container.querySelector("[data-doc]")?.getAttribute("data-doc")).toBe(
        "uncontrolled"
      );
    });
  });
});
