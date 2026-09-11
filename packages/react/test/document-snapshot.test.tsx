import type {
  CaptureDocumentSnapshotOptions,
  EditorAPI,
  EditorDocumentSnapshot,
} from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { Editor, useEditor, type UseEditorResult } from "@floatboat/nexus-react";
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("React document snapshots through the public editor instance", () => {
  it("exposes the same snapshot-capable EditorAPI through the hook and onReady", async () => {
    const ready: EditorAPI[] = [];
    const published: EditorAPI[] = [];
    function Harness() {
      const binding: UseEditorResult = useEditor({
        initialValue: "# Hook document",
        onReady: (editor) => ready.push(editor),
      });
      useEffect(() => {
        if (binding.editor) published.push(binding.editor);
      }, [binding.editor]);
      return <div ref={binding.containerRef} />;
    }
    render(<Harness />);
    const editor = published.at(-1);
    if (!editor) throw new Error("Hook did not expose its editor");
    expect(editor).toBe(ready[0]);

    const options: CaptureDocumentSnapshotOptions = { includeRenderAst: true };
    const snapshot: EditorDocumentSnapshot = await editor.captureDocumentSnapshot(options);

    expect(snapshot.markdown).toBe("# Hook document");
    expect(snapshot.renderAst?.children[0]).toMatchObject({ type: "heading", depth: 1 });
  });

  it("captures pending table input through onReady without echoing the stale controlled value", async () => {
    const value = "| A | B |\n| --- | --- |\n| 1 | old |";
    const onChange = vi.fn();
    const ready = vi.fn<(editor: EditorAPI) => void>();
    const { container } = render(
      <Editor value={value} livePreview plugins={[createGfmPreset()]} onReady={ready} onChange={onChange} />
    );
    const editor = ready.mock.calls[0]?.[0];
    if (!editor) throw new Error("Component did not expose its editor");
    const cells = container.querySelectorAll<HTMLElement>(".nexus-cell");
    const cell = cells[cells.length - 1];
    if (!cell) throw new Error("Missing table cell");
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    // jsdom needs an explicit tab stop for a contentEditable cell to receive focus.
    cell.tabIndex = -1;
    cell.focus();
    cell.textContent = "pending 中文";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    const selection = editor.getSelection();

    const snapshot = await editor.captureDocumentSnapshot();

    expect(snapshot).toEqual({ markdown: "| A | B |\n| --- | --- |\n| 1 | pending 中文 |", revision: editor.getDocumentRevision?.() });
    expect(editor.getDocument()).toBe(value);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getSelection()).toEqual(selection);
    expect(document.activeElement).toBe(cell);
  });

  it.each(["component", "hook"] as const)("aborts a pending snapshot when the %s unmounts", async (kind) => {
    const ready = vi.fn<(editor: EditorAPI) => void>();
    function Harness() {
      const { containerRef } = useEditor({ initialValue: "Waiting", onReady: ready });
      return <div ref={containerRef} />;
    }
    const { container, unmount } = render(
      kind === "component" ? <Editor initialValue="Waiting" onReady={ready} /> : <Harness />
    );
    const editor = ready.mock.calls[0]?.[0];
    const content = container.querySelector(".cm-content");
    if (!editor || !content) throw new Error("Missing mounted editor");
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(editor.isComposing()).toBe(true);
    const settled = vi.fn();
    const pending = editor.captureDocumentSnapshot();
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    void pending.then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).not.toHaveBeenCalled();

    unmount();

    await rejection;
    expect(settled).toHaveBeenCalledOnce();
    expect(settled.mock.calls[0]?.[0]).toMatchObject({ name: "AbortError" });
    await expect(editor.captureDocumentSnapshot()).rejects.toMatchObject({ name: "AbortError" });
  });
});
