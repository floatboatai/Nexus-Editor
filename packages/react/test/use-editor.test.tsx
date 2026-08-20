import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { Editor } from "../src";
import type { EditorAPI } from "@floatboat/nexus-core";

/**
 * Coverage for the React binding (`useEditor` hook + `Editor` component).
 *
 * All of these render the real editor through the React layer inside jsdom.
 * We never touch the editor's own `src/` — only its public API — so this is a
 * pure additive test PR, same policy as the other packages.
 */

let editor: EditorAPI | undefined;

beforeEach(() => {
  editor = undefined;
});

afterEach(() => {
  cleanup();
});

describe("Editor / useEditor", () => {
  it("calls onReady exactly once with a usable editor instance", () => {
    const onReady = vi.fn();
    render(<Editor onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    const instance = onReady.mock.calls[0][0];
    expect(instance).toBeTruthy();
    expect(typeof instance.getDocument).toBe("function");
    // A freshly created editor starts with an empty document.
    expect(instance.getDocument()).toBe("");
  });

  it("initializes the editor with the provided initialValue", () => {
    render(
      <Editor
        onReady={(e) => {
          editor = e;
        }}
        initialValue="# Title"
      />
    );

    expect(editor!.getDocument()).toBe("# Title");
  });

  it("fires onChange when the document is changed programmatically", () => {
    const onChange = vi.fn();
    render(
      <Editor
        onReady={(e) => {
          editor = e;
        }}
        initialValue="start"
        onChange={onChange}
      />
    );

    // Initial creation must NOT count as a change.
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      editor!.setDocument("changed");
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("changed");
  });

  it("applies an external controlled value via silent setDocument (no feedback loop)", () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <Editor
        onReady={(e) => {
          editor = e;
        }}
        value="first"
        onChange={onChange}
      />
    );

    // Mounting with a controlled value seeds the initial document; it must not fire onChange.
    expect(onChange).not.toHaveBeenCalled();
    expect(editor!.getDocument()).toBe("first");

    rerender(
      <Editor
        onReady={(e) => {
          editor = e;
        }}
        value="second"
        onChange={onChange}
      />
    );

    // The external value changed, but the sync path is silent, so onChange
    // must NOT fire — otherwise we'd create an infinite update loop.
    expect(onChange).not.toHaveBeenCalled();
    expect(editor!.getDocument()).toBe("second");
  });

  it("destroys the underlying editor when the component unmounts", () => {
    const { unmount } = render(
      <Editor
        onReady={(e) => {
          editor = e;
        }}
      />
    );

    const destroy = vi.spyOn(editor!, "destroy");
    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards container DOM attributes through divProps", () => {
    render(
      <Editor
        data-testid="ned-root"
        className="my-editor-class"
        aria-label="markdown editor"
      />
    );

    const el = document.querySelector('[data-testid="ned-root"]');
    expect(el).toBeTruthy();
    expect(el?.className).toContain("my-editor-class");
    expect(el?.getAttribute("aria-label")).toBe("markdown editor");
  });
});
