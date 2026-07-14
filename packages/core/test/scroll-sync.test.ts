import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  collectScrollSyncAnchors,
  createEditor,
  createScrollSync,
  previewTopToSourceOffset,
  sourceOffsetToPreviewTop,
  type EditorAPI,
  type ScrollSyncAnchor,
} from "../src/index";

// Two blocks of 100px separated by a 20px gap, covering source [0,50) and
// [60,100). The gap [50,60) maps to the whitespace between them.
const ANCHORS: ScrollSyncAnchor[] = [
  { from: 0, to: 50, top: 0, bottom: 100 },
  { from: 60, to: 100, top: 120, bottom: 220 },
];

describe("sourceOffsetToPreviewTop", () => {
  it("returns null without anchors", () => {
    expect(sourceOffsetToPreviewTop([], 10)).toBeNull();
  });

  it("interpolates inside a block", () => {
    expect(sourceOffsetToPreviewTop(ANCHORS, 0)).toBe(0);
    expect(sourceOffsetToPreviewTop(ANCHORS, 25)).toBe(50);
    expect(sourceOffsetToPreviewTop(ANCHORS, 50)).toBe(100);
  });

  it("interpolates across the gap between blocks", () => {
    expect(sourceOffsetToPreviewTop(ANCHORS, 55)).toBe(110);
  });

  it("clamps past the last block", () => {
    expect(sourceOffsetToPreviewTop(ANCHORS, 100)).toBe(220);
    expect(sourceOffsetToPreviewTop(ANCHORS, 9999)).toBe(220);
  });

  it("maps offsets before the first block toward the top", () => {
    const anchors: ScrollSyncAnchor[] = [{ from: 10, to: 20, top: 30, bottom: 60 }];
    expect(sourceOffsetToPreviewTop(anchors, 0)).toBe(0);
    expect(sourceOffsetToPreviewTop(anchors, 5)).toBe(15);
  });

  it("tolerates zero-width source ranges", () => {
    const anchors: ScrollSyncAnchor[] = [{ from: 5, to: 5, top: 10, bottom: 30 }];
    expect(sourceOffsetToPreviewTop(anchors, 5)).toBe(10);
  });
});

describe("mapping edge cases", () => {
  it("never produces NaN and stays monotonic across the whole range", () => {
    // Sweep the full source range including gaps and out-of-range values:
    // mapped positions must be finite and non-decreasing.
    let lastTop = -Infinity;
    for (let offset = -10; offset <= 120; offset++) {
      const top = sourceOffsetToPreviewTop(ANCHORS, offset)!;
      expect(Number.isFinite(top)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(lastTop);
      lastTop = top;
    }
  });

  it("inverse mapping is monotonic and finite too", () => {
    let lastOffset = -Infinity;
    for (let top = -20; top <= 260; top += 2) {
      const offset = previewTopToSourceOffset(ANCHORS, top)!;
      expect(Number.isFinite(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(lastOffset);
      lastOffset = offset;
    }
  });

  it("handles negative scroll positions (elastic overscroll)", () => {
    expect(previewTopToSourceOffset(ANCHORS, -50)).toBe(0);
    expect(sourceOffsetToPreviewTop(ANCHORS, -50)).toBe(0);
  });

  it("handles a single zero-height anchor without dividing by zero", () => {
    const anchors: ScrollSyncAnchor[] = [{ from: 0, to: 10, top: 40, bottom: 40 }];
    expect(sourceOffsetToPreviewTop(anchors, 5)).toBe(40);
    expect(previewTopToSourceOffset(anchors, 40)).toBe(0);
  });
});

describe("previewTopToSourceOffset", () => {
  it("returns null without anchors", () => {
    expect(previewTopToSourceOffset([], 10)).toBeNull();
  });

  it("is the inverse of sourceOffsetToPreviewTop inside blocks", () => {
    for (const offset of [0, 10, 25, 50, 55, 60, 80, 100]) {
      const top = sourceOffsetToPreviewTop(ANCHORS, offset)!;
      expect(previewTopToSourceOffset(ANCHORS, top)).toBe(offset);
    }
  });

  it("interpolates across the gap between blocks", () => {
    expect(previewTopToSourceOffset(ANCHORS, 110)).toBe(55);
  });

  it("clamps past the last block", () => {
    expect(previewTopToSourceOffset(ANCHORS, 9999)).toBe(100);
  });
});

describe("collectScrollSyncAnchors", () => {
  function block(from: number | string, to: number | string): HTMLElement {
    const el = document.createElement("p");
    el.setAttribute("data-nexus-from", String(from));
    el.setAttribute("data-nexus-to", String(to));
    return el;
  }

  it("reads offsets and sorts by source position", () => {
    const container = document.createElement("div");
    container.append(block(60, 100), block(0, 50));

    const anchors = collectScrollSyncAnchors(container);

    expect(anchors.map((a) => a.from)).toEqual([0, 60]);
    expect(anchors.map((a) => a.to)).toEqual([50, 100]);
  });

  it("skips elements with invalid or inverted ranges", () => {
    const container = document.createElement("div");
    container.append(block("oops", 10), block(50, 10), block(0, 10));

    expect(collectScrollSyncAnchors(container)).toHaveLength(1);
  });

  it("returns an empty list for un-stamped content", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>plain</p>";

    expect(collectScrollSyncAnchors(container)).toEqual([]);
  });
});

describe("createScrollSync", () => {
  // jsdom has no layout, so give the preview blocks real geometry by
  // stubbing getBoundingClientRect. Block rects shift up as the container
  // scrolls — same physics as a real browser — so anchor collection sees
  // consistent content coordinates at any scroll position.
  function createPreview(): HTMLElement {
    const preview = document.createElement("div");
    const rectAt = (top: number, bottom: number): DOMRect =>
      ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top } as DOMRect);
    preview.getBoundingClientRect = () => rectAt(0, 300);

    const stubBlock = (from: number, to: number, top: number, bottom: number): HTMLElement => {
      const el = document.createElement("p");
      el.setAttribute("data-nexus-from", String(from));
      el.setAttribute("data-nexus-to", String(to));
      el.getBoundingClientRect = () => rectAt(top - preview.scrollTop, bottom - preview.scrollTop);
      return el;
    };

    preview.append(stubBlock(0, 50, 0, 100), stubBlock(60, 100, 120, 220));
    document.body.appendChild(preview);
    return preview;
  }

  interface StubEditor {
    api: EditorAPI;
    emitScroll(): void;
    scrollAnchor: number;
    scrollToAnchor: ReturnType<typeof vi.fn>;
  }

  function createStubEditor(): StubEditor {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const scrollToAnchor = vi.fn();
    const stub: StubEditor = {
      scrollAnchor: 0,
      scrollToAnchor,
      emitScroll() {
        for (const handler of handlers.get("scroll") ?? []) handler();
      },
      api: {
        on(event: string, handler: (...args: unknown[]) => void) {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event)!.add(handler);
        },
        off(event: string, handler: (...args: unknown[]) => void) {
          handlers.get(event)?.delete(handler);
        },
        getScrollAnchor: () => stub.scrollAnchor,
        scrollToAnchor,
      } as unknown as EditorAPI,
    };
    return stub;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("aligns the preview when the editor scrolls", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    editor.scrollAnchor = 25;
    editor.emitScroll();
    vi.advanceTimersByTime(20); // flush the rAF-coalesced handler

    expect(preview.scrollTop).toBe(50);
    sync.destroy();
  });

  it("aligns the editor when the preview scrolls", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    preview.scrollTop = 110;
    preview.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(editor.scrollToAnchor).toHaveBeenCalledWith(55);
    sync.destroy();
  });

  it("ignores echo scrolls on the passive pane while the other drives", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    editor.scrollAnchor = 25;
    editor.emitScroll();
    vi.advanceTimersByTime(20);
    expect(preview.scrollTop).toBe(50);

    // The programmatic scrollTop write above echoes as a preview scroll
    // event inside the lock window — it must not bounce back to the editor.
    preview.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(editor.scrollToAnchor).not.toHaveBeenCalled();

    sync.destroy();
  });

  it("hands the driver role back after the lock window lapses", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    editor.scrollAnchor = 25;
    editor.emitScroll();
    vi.advanceTimersByTime(200); // rAF flush + lock expiry

    preview.scrollTop = 110;
    preview.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(editor.scrollToAnchor).toHaveBeenCalledWith(55);
    sync.destroy();
  });

  it("ignores editor scrolls while the preview is hidden", () => {
    const preview = createPreview();
    preview.hidden = true;
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    editor.scrollAnchor = 25;
    editor.emitScroll();
    vi.advanceTimersByTime(20);

    expect(preview.scrollTop).toBe(0);
    sync.destroy();
  });

  it("refresh() re-measures and re-aligns the preview immediately", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });

    editor.scrollAnchor = 25;
    sync.refresh();

    expect(preview.scrollTop).toBe(50);
    sync.destroy();
  });

  it("stops reacting after destroy", () => {
    const preview = createPreview();
    const editor = createStubEditor();
    const sync = createScrollSync({ editor: editor.api, preview });
    sync.destroy();

    editor.scrollAnchor = 25;
    editor.emitScroll();
    preview.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(preview.scrollTop).toBe(0);
    expect(editor.scrollToAnchor).not.toHaveBeenCalled();
  });
});

describe("editor scroll API", () => {
  it("emits scroll events from the CM6 scroll container", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container, initialValue: "hello" });

    editor.on("scroll", handler);
    container.querySelector(".cm-scroller")!.dispatchEvent(new Event("scroll"));

    expect(handler).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("does not emit scroll after destroy", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container, initialValue: "hello" });
    const scroller = container.querySelector(".cm-scroller")!;

    editor.on("scroll", handler);
    editor.destroy();
    scroller.dispatchEvent(new Event("scroll"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("getScrollAnchor returns a document offset without layout", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# One\n\ntwo\n\nthree" });

    // jsdom has no layout engine — the exact value is estimation-based, but
    // it must be a valid in-range offset and must not throw.
    const anchor = editor.getScrollAnchor();
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeLessThanOrEqual(editor.getDocument().length);
    editor.destroy();
  });

  it("handles an empty document without throwing", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "" });

    expect(editor.getScrollAnchor()).toBe(0);
    expect(() => editor.scrollToAnchor(0)).not.toThrow();
    editor.destroy();
  });

  it("scrollToAnchor clamps out-of-range offsets and never throws", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello\nworld" });

    expect(() => editor.scrollToAnchor(-5)).not.toThrow();
    expect(() => editor.scrollToAnchor(10_000)).not.toThrow();
    editor.destroy();
    expect(() => editor.scrollToAnchor(0)).not.toThrow();
    expect(editor.getScrollAnchor()).toBe(0);
  });
});
