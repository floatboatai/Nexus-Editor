import { describe, expect, it, vi } from "vitest";
import type { EditorAPI, TocEntry } from "@floatboat/nexus-core";
import { createOutlinePanel } from "../src/renderer/outline-panel";

type AnyHandler = (...args: never[]) => void;

function createMockEditor(toc: TocEntry[] = []) {
  const listeners = new Map<string, Set<AnyHandler>>();
  const editor = {
    on: vi.fn((event: string, handler: AnyHandler) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
    }),
    off: vi.fn((event: string, handler: AnyHandler) => {
      listeners.get(event)?.delete(handler);
    }),
    getTableOfContents: vi.fn(() => toc),
    setSelection: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorAPI & {
    getTableOfContents: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };

  return { editor, listeners };
}

function trigger(listeners: Map<string, Set<AnyHandler>>, event: string, ...args: never[]) {
  for (const handler of listeners.get(event) ?? []) {
    handler(...args);
  }
}

function listTexts(panel: HTMLElement): string[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).map(
    (b) => b.textContent ?? "",
  );
}

describe("createOutlinePanel", () => {
  it("shows a placeholder when the document has no headings", () => {
    const { editor } = createMockEditor([]);
    const panel = createOutlinePanel(editor);

    expect(panel.element.textContent).toContain("Outline");
    expect(panel.element.textContent).toContain("No headings");
    panel.destroy();
  });

  it("renders headings from the initial table of contents", () => {
    const toc: TocEntry[] = [
      { level: 1, text: "Title", from: 0, to: 7 },
      { level: 2, text: "Section", from: 9, to: 18 },
    ];
    const { editor } = createMockEditor(toc);
    const panel = createOutlinePanel(editor);

    expect(listTexts(panel.element)).toEqual(["Title", "Section"]);
    panel.destroy();
  });

  it("refreshes when the document is loaded (documentLoad)", () => {
    const { editor, listeners } = createMockEditor([]);
    const panel = createOutlinePanel(editor);
    expect(listTexts(panel.element)).toEqual([]);

    const toc: TocEntry[] = [{ level: 1, text: "Loaded", from: 0, to: 8 }];
    editor.getTableOfContents.mockReturnValue(toc);
    trigger(listeners, "documentLoad");

    expect(listTexts(panel.element)).toEqual(["Loaded"]);
    panel.destroy();
  });

  it("still refreshes on ordinary changes", () => {
    const { editor, listeners } = createMockEditor([]);
    const panel = createOutlinePanel(editor);

    const toc: TocEntry[] = [{ level: 2, text: "Edited", from: 2, to: 10 }];
    editor.getTableOfContents.mockReturnValue(toc);
    trigger(listeners, "change");

    expect(listTexts(panel.element)).toEqual(["Edited"]);
    panel.destroy();
  });

  it("unsubscribes from all events on destroy", () => {
    const { editor, listeners } = createMockEditor([]);
    const panel = createOutlinePanel(editor);
    panel.destroy();

    expect(editor.off).toHaveBeenCalledWith("change", expect.any(Function));
    expect(editor.off).toHaveBeenCalledWith("documentLoad", expect.any(Function));
    expect(listeners.get("change")?.size).toBe(0);
    expect(listeners.get("documentLoad")?.size).toBe(0);
  });
});
