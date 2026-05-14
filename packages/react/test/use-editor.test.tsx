import { describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import React, { createRef } from "react";
import type { EditorAPI } from "@floatboat/nexus-core";
import { Editor, useEditor } from "@floatboat/nexus-react";

// ---------------------------------------------------------------------------
// useEditor hook
// ---------------------------------------------------------------------------

describe("useEditor", () => {
  it("returns a non-null editor after mount", () => {
    let capturedEditor: EditorAPI | null = null;

    function TestComponent() {
      const { containerRef, editor } = useEditor({
        initialValue: "hello",
        onReady: (e) => { capturedEditor = e; },
      });
      return <div ref={containerRef} />;
    }

    render(<TestComponent />);
    expect(capturedEditor).not.toBeNull();
  });

  it("calls onReady exactly once with the EditorAPI instance", () => {
    const onReady = vi.fn();

    function TestComponent() {
      const { containerRef } = useEditor({ onReady });
      return <div ref={containerRef} />;
    }

    render(<TestComponent />);
    expect(onReady).toHaveBeenCalledTimes(1);
    const instance = onReady.mock.calls[0][0] as EditorAPI;
    expect(typeof instance.getDocument).toBe("function");
    expect(typeof instance.setDocument).toBe("function");
  });

  it("does not throw when onReady is omitted", () => {
    function TestComponent() {
      const { containerRef } = useEditor({ initialValue: "test" });
      return <div ref={containerRef} />;
    }

    expect(() => render(<TestComponent />)).not.toThrow();
  });

  it("onReady is not passed to createEditor (no unknown-prop warning)", () => {
    // If onReady leaked into EditorConfig, createEditor would receive an
    // unrecognised key. We verify the editor still initialises cleanly.
    const onReady = vi.fn();

    function TestComponent() {
      const { containerRef, editor } = useEditor({ initialValue: "hi", onReady });
      return <div ref={containerRef} data-doc={editor?.getDocument()} />;
    }

    const { container } = render(<TestComponent />);
    expect(container.querySelector("[data-doc]")?.getAttribute("data-doc")).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// <Editor /> component
// ---------------------------------------------------------------------------

describe("Editor component", () => {
  it("mounts a CM6 editor inside the container", () => {
    const { container } = render(<Editor initialValue="hello" />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("forwards ref to EditorAPI", () => {
    const ref = createRef<EditorAPI>();
    render(<Editor ref={ref} initialValue="world" />);
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current!.getDocument).toBe("function");
    expect(ref.current!.getDocument()).toBe("world");
  });

  it("ref is null before mount and non-null after", () => {
    const ref = createRef<EditorAPI>();
    expect(ref.current).toBeNull();
    render(<Editor ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("applies className to the container div", () => {
    const { container } = render(<Editor className="my-editor" />);
    expect(container.firstElementChild?.classList.contains("my-editor")).toBe(true);
  });

  it("applies style to the container div", () => {
    const { container } = render(<Editor style={{ height: "400px" }} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.height).toBe("400px");
  });

  it("calls onReady with EditorAPI on mount", () => {
    const onReady = vi.fn();
    render(<Editor onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(typeof onReady.mock.calls[0][0].getDocument).toBe("function");
  });

  it("destroys the editor on unmount", () => {
    const ref = createRef<EditorAPI>();
    const { unmount } = render(<Editor ref={ref} />);
    const instance = ref.current!;
    const destroySpy = vi.spyOn(instance, "destroy");
    unmount();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
