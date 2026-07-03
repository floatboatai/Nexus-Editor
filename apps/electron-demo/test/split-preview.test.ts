import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "@floatboat/nexus-core";
import type { Root } from "mdast";
import { createSplitPreview } from "../src/renderer/split-preview";

let resizeCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function triggerResize(target: Element): void {
  for (const callback of resizeCallbacks) {
    callback([{ target } as ResizeObserverEntry], {} as ResizeObserver);
  }
}

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
}

function mockRect(element: Element, top: number, height = 20): void {
  element.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: top,
    left: 0,
    top,
    right: 100,
    bottom: top + height,
    width: 100,
    height,
    toJSON: () => ({}),
  } as DOMRect));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function previewFragment(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const [line, offset, label] of [
    [1, 0, "start"],
    [101, 400, "quarter"],
    [201, 800, "middle"],
    [301, 1200, "three-quarter"],
    [401, 1600, "late"],
  ] as const) {
    const p = document.createElement("p");
    p.dataset.sourceLine = String(line === 201 ? line : 0);
    p.dataset.sourceOffset = String(offset);
    p.dataset.sourceType = "paragraph";
    p.textContent = label;
    fragment.appendChild(p);
  }
  return fragment;
}

function longBlockPreviewFragment(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const first = document.createElement("p");
  first.dataset.sourceLine = "1";
  first.dataset.sourceOffset = "0";
  first.dataset.sourceEndOffset = "100";
  first.dataset.sourceType = "paragraph";
  first.textContent = "first";
  fragment.appendChild(first);

  const long = document.createElement("div");
  long.dataset.sourceLine = "101";
  long.dataset.sourceOffset = "400";
  long.dataset.sourceEndOffset = "1600";
  long.dataset.sourceType = "html";
  long.textContent = "long html block";
  fragment.appendChild(long);
  return fragment;
}

function createEditorStub(sourceScroller: HTMLElement): EditorAPI {
  let currentScrollTop = 0;
  const getMaxScroll = () => Math.max(0, sourceScroller.scrollHeight - sourceScroller.clientHeight);
  const editor: EditorAPI = {
    getDocument: vi.fn(() => "a\n".repeat(500)),
    getAst: vi.fn((): Root => ({ type: "root", children: [] })),
    getTableOfContents: vi.fn(() => []),
    exportHTML: vi.fn(() => ""),
    setTheme: vi.fn(),
    getSelection: vi.fn(() => ({ anchor: 5, head: 5 })),
    getSelections: vi.fn(() => ({ ranges: [{ anchor: 5, head: 5 }], mainIndex: 0 })),
    getSelectedText: vi.fn(() => ""),
    getSlashCommands: vi.fn(() => []),
    uploadAsset: vi.fn(async () => null),
    setSelection: vi.fn(),
    getScrollTop: vi.fn(() => currentScrollTop),
    setScrollTop: vi.fn((top: number) => {
      currentScrollTop = Math.max(0, Math.min(getMaxScroll(), top));
      sourceScroller.scrollTop = currentScrollTop;
    }),
    getScrollMax: vi.fn(() => getMaxScroll()),
    getScrollElement: vi.fn(() => sourceScroller),
    getPositionAtLine: vi.fn((line: number) => (line - 1) * 4),
    getLineNumberAtPosition: vi.fn((pos: number) => Math.floor(pos / 4) + 1),
    getLineBlockAtPosition: vi.fn((pos: number) => {
      const line = Math.floor(pos / 4) + 1;
      const top = (line - 1) * 4;
      return { from: pos, to: pos + 1, top, bottom: top + 16, height: 16 };
    }),
    getLineBlockAtHeight: vi.fn((height: number) => {
      const line = Math.floor(height / 4) + 1;
      const from = (line - 1) * 4;
      const top = (line - 1) * 4;
      return { from, to: from + 1, top, bottom: top + 16, height: 16 };
    }),
    setSelections: vi.fn(),
    setDocument: vi.fn(),
    replaceSelection: vi.fn(),
    replaceRange: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    focus: vi.fn(),
    blur: vi.fn(),
    runShortcut: vi.fn(() => false),
    getCommands: vi.fn(() => []),
    runCommand: vi.fn(() => false),
    isComposing: vi.fn(() => false),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getCoordsAtPos: vi.fn(() => null),
    getPosAtDOM: vi.fn(() => null),
    getDocumentStats: vi.fn(() => ({ characters: 1000, words: 500, lines: 500 })),
  };
  return editor;
}

async function setupPreview(): Promise<{ preview: ReturnType<typeof createSplitPreview>; editor: EditorAPI; sourceScroller: HTMLElement }> {
  const sourceScroller = document.createElement("div");
  setScrollMetrics(sourceScroller, 1800, 200);
  mockRect(sourceScroller, 0, 200);
  const editor = createEditorStub(sourceScroller);
  const preview = createSplitPreview({
    editor,
    editorColumn: document.createElement("div"),
    renderPreview: previewFragment,
  });
  setScrollMetrics(preview.element, 1200, 200);
  mockRect(preview.element, 0, 200);
  preview.setOpen(true);
  const blocks = Array.from(preview.element.querySelectorAll("[data-source-line]"));
  for (let i = 0; i < blocks.length; i++) mockRect(blocks[i], i * 250);
  preview.update();
  const updatedBlocks = Array.from(preview.element.querySelectorAll("[data-source-line]"));
  for (let i = 0; i < updatedBlocks.length; i++) mockRect(updatedBlocks[i], i * 250);
  await nextFrame();
  return { preview, editor, sourceScroller };
}

async function setupLongBlockPreview(): Promise<{ preview: ReturnType<typeof createSplitPreview>; sourceScroller: HTMLElement }> {
  const sourceScroller = document.createElement("div");
  setScrollMetrics(sourceScroller, 1800, 200);
  mockRect(sourceScroller, 0, 200);
  const editor = createEditorStub(sourceScroller);
  const preview = createSplitPreview({
    editor,
    editorColumn: document.createElement("div"),
    renderPreview: longBlockPreviewFragment,
  });
  setScrollMetrics(preview.element, 1000, 200);
  mockRect(preview.element, 0, 200);
  preview.setOpen(true);
  preview.update();
  const blocks = Array.from(preview.element.querySelectorAll("[data-source-line]"));
  mockRect(blocks[0], 0, 50);
  mockRect(blocks[1], 200, 600);
  await nextFrame();
  return { preview, sourceScroller };
}

describe("split preview", () => {
  beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  it("syncs preview scroll to editor scroll using source lines without moving selection", async () => {
    const { preview, editor, sourceScroller } = await setupPreview();

    preview.element.scrollTop = 500;
    preview.element.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(sourceScroller.scrollTop).toBeGreaterThan(0);
    expect(sourceScroller.scrollTop).toBeLessThan(1600);
    expect(editor.setSelection).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("does not snap editor to bottom before preview actually reaches bottom", async () => {
    const { preview, sourceScroller } = await setupPreview();

    for (const top of [750, 900, 950]) {
      sourceScroller.scrollTop = 0;
      preview.element.scrollTop = top;
      preview.element.dispatchEvent(new Event("scroll"));
      await nextFrame();
      expect(sourceScroller.scrollTop).toBeLessThan(1600);
    }
  });

  it("snaps editor to bottom only when preview reaches bottom", async () => {
    const { preview, sourceScroller } = await setupPreview();

    preview.element.scrollTop = 1000;
    preview.element.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(Math.abs(sourceScroller.scrollTop - 1600)).toBeLessThanOrEqual(1);
  });

  it("syncs editor scroll to preview scroll using source lines without moving selection", async () => {
    const { preview, editor, sourceScroller } = await setupPreview();

    sourceScroller.scrollTop = 800;
    sourceScroller.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(preview.element.scrollTop).toBeGreaterThan(0);
    expect(preview.element.scrollTop).toBeLessThan(1000);
    expect(editor.setSelection).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("does not snap preview to bottom at editor 25, 50, or 75 percent", async () => {
    const { preview, sourceScroller } = await setupPreview();

    for (const top of [400, 800, 1200]) {
      preview.element.scrollTop = 0;
      sourceScroller.scrollTop = top;
      sourceScroller.dispatchEvent(new Event("scroll"));
      await nextFrame();
      expect(preview.element.scrollTop).toBeLessThan(1000);
    }
  });

  it("snaps preview to bottom only when editor reaches bottom", async () => {
    const { preview, sourceScroller } = await setupPreview();

    sourceScroller.scrollTop = 1600;
    sourceScroller.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(Math.abs(preview.element.scrollTop - 1000)).toBeLessThanOrEqual(1);
  });

  it("keeps both sides at bottom when the editor scroll range grows after a fast bottom drag", async () => {
    const { preview, sourceScroller } = await setupPreview();

    sourceScroller.scrollTop = 1600;
    sourceScroller.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(Math.abs(preview.element.scrollTop - 1000)).toBeLessThanOrEqual(1);

    setScrollMetrics(sourceScroller, 2200, 200);
    triggerResize(sourceScroller);
    await nextFrame();

    expect(Math.abs(sourceScroller.scrollTop - 2000)).toBeLessThanOrEqual(1);
    expect(Math.abs(preview.element.scrollTop - 1000)).toBeLessThanOrEqual(1);
  });

  it("maps editor scrolling inside a long final preview block instead of sticking at bottom", async () => {
    const { preview, sourceScroller } = await setupLongBlockPreview();

    sourceScroller.scrollTop = 800;
    sourceScroller.dispatchEvent(new Event("scroll"));
    await nextFrame();
    const middlePreviewTop = preview.element.scrollTop;

    sourceScroller.scrollTop = 1200;
    sourceScroller.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(middlePreviewTop).toBeGreaterThan(0);
    expect(middlePreviewTop).toBeLessThan(preview.element.scrollTop);
    expect(preview.element.scrollTop).toBeLessThan(800);
  });
});
