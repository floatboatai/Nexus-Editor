import { describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "@floatboat/nexus-core";
import { createSearchBar } from "../src/renderer/search-bar";

function createMockEditor(initialDoc = "alpha beta alpha") {
  let doc = initialDoc;
  const editor = {
    getDocument: vi.fn(() => doc),
    setDocument: vi.fn((d: string) => {
      doc = d;
    }),
    getSelection: vi.fn(() => ({ anchor: 0, head: 0 })),
    setSelection: vi.fn(),
    focus: vi.fn(),
    highlightRanges: vi.fn(),
    clearHighlight: vi.fn(),
  } as unknown as EditorAPI & {
    getDocument: ReturnType<typeof vi.fn>;
    setDocument: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    highlightRanges: ReturnType<typeof vi.fn>;
    clearHighlight: ReturnType<typeof vi.fn>;
  };
  return { editor };
}

function mountBar() {
  const { editor } = createMockEditor();
  const bar = createSearchBar(editor);
  const container = document.createElement("div");
  container.append(bar.element);
  document.body.append(container);
  bar.open();
  const findInput = container.querySelector<HTMLInputElement>(
    'input[placeholder="Find..."]',
  )!;
  return { editor, bar, container, findInput };
}

describe("createSearchBar", () => {
  it("highlights all matches while typing but keeps focus in the input", () => {
    const { editor, bar, container, findInput } = mountBar();

    findInput.value = "alpha";
    findInput.dispatchEvent(new Event("input", { bubbles: true }));

    // All matches highlighted via the new highlight API; no selection change,
    // no focus steal. (findSearchMatches returns extra `text` fields.)
    expect(editor.highlightRanges).toHaveBeenCalledWith(
      [
        expect.objectContaining({ from: 0, to: 5 }),
        expect.objectContaining({ from: 11, to: 16 }),
      ],
      0,
    );
    expect(editor.setSelection).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 / 2");

    bar.destroy();
    container.remove();
  });

  it("keeps focus in the input when Enter jumps to the next match", () => {
    const { editor, bar, container, findInput } = mountBar();

    findInput.value = "alpha";
    findInput.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus.mockClear();

    findInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(editor.setSelection).toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2 / 2");

    bar.destroy();
    container.remove();
  });

  it("moves focus to the editor only when clicking the next button", () => {
    const { editor, bar, container, findInput } = mountBar();
    const nextBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Next match"]',
    )!;

    findInput.value = "alpha";
    findInput.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus.mockClear();

    nextBtn.click();

    expect(editor.focus).toHaveBeenCalledTimes(1);

    bar.destroy();
    container.remove();
  });

  it("does not steal focus back to the editor after replace", () => {
    const { editor, bar, container, findInput } = mountBar();
    const replaceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Replace..."]',
    )!;

    findInput.value = "alpha";
    findInput.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus.mockClear();

    replaceInput.value = "beta";
    replaceInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(editor.setDocument).toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();

    bar.destroy();
    container.remove();
  });

  it("clears highlights and restores focus to the editor when closed", () => {
    const { editor, bar, container } = mountBar();
    editor.focus.mockClear();
    editor.clearHighlight.mockClear();

    bar.close();

    expect(editor.clearHighlight).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalledTimes(1);

    container.remove();
  });
});
