import type { EditorAPI } from "@floatboat/nexus-core";
import { render, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
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

  it("Strict Mode only attaches/detaches a borrowed runtime and never disposes it", async () => {
    const events: string[] = [];
    const borrowed = {
      attachEditor: vi.fn(() => {
        events.push("attach");
        return { detach: () => void events.push("detach") };
      }),
      dispose: vi.fn(),
    };
    const { unmount } = render(
      <StrictMode>
        <Editor runtime={{ kind: "borrowed", runtime: borrowed }} />
      </StrictMode>
    );
    await waitFor(() => expect(borrowed.attachEditor).toHaveBeenCalledTimes(2));
    expect(events).toEqual(["attach", "detach", "attach"]);

    unmount();
    expect(events).toEqual(["attach", "detach", "attach", "detach"]);
    expect(borrowed.dispose).not.toHaveBeenCalled();
  });

  it("disposes an owned runtime after detaching its editor", async () => {
    const events: string[] = [];
    const runtime = {
      attachEditor: () => ({
        detach: async () => { events.push("detach"); },
      }),
      dispose: async () => { events.push("dispose"); },
    };
    const createRuntime = vi.fn(() => runtime);
    const { unmount } = render(
      <Editor runtime={{ kind: "owned", createRuntime }} />
    );
    expect(createRuntime).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(events).toEqual(["detach", "dispose"]));
  });

  it("attaches multiple editors to one borrowed runtime independently", () => {
    const attached: EditorAPI[] = [];
    const detached: EditorAPI[] = [];
    const runtime = {
      attachEditor(editor: EditorAPI) {
        attached.push(editor);
        return { detach: () => void detached.push(editor) };
      },
    };
    const { unmount } = render(<>
      <Editor initialValue="first" runtime={{ kind: "borrowed", runtime }} />
      <Editor initialValue="second" runtime={{ kind: "borrowed", runtime }} />
    </>);
    expect(attached).toHaveLength(2);
    expect(attached[0]).not.toBe(attached[1]);
    unmount();
    expect(detached).toEqual(attached);
  });

  it("forwards htmlPaste=false so structured HTML paste is not converted", () => {
    let ready: EditorAPI | null = null;
    const { container } = render(
      <Editor
        initialValue=""
        htmlPaste={false}
        onReady={(editor) => {
          ready = editor;
        }}
      />
    );

    const content = container.querySelector("[contenteditable='true']") as HTMLElement;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        items: [],
        getData: (type: string) => (type === "text/html" ? "<h1>Title</h1>" : "Title"),
      },
    });
    content.dispatchEvent(event);

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).not.toContain("# Title");
  });

  it("converts structured HTML paste through the Editor component by default", () => {
    let ready: EditorAPI | null = null;
    const { container } = render(
      <Editor
        initialValue=""
        onReady={(editor) => {
          ready = editor;
        }}
      />
    );

    const content = container.querySelector("[contenteditable='true']") as HTMLElement;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        items: [],
        getData: (type: string) => (type === "text/html" ? "<h1>Title</h1>" : "Title"),
      },
    });
    content.dispatchEvent(event);

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).toBe("# Title");
  });
});
