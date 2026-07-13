import type { EditorAPI } from "@floatboat/nexus-core";

export interface SplitPreview {
  element: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
  toggle(): boolean;
  update(): void;
  destroy(): void;
}

export interface SplitPreviewOptions {
  editor: EditorAPI;
  editorColumn: HTMLElement;
  renderPreview: () => DocumentFragment;
}

interface ScrollSyncAnchor {
  line: number;
  offset: number;
  endOffset: number;
  previewTop: number;
  previewBottom?: number;
  blockType?: string;
}

interface AnchorStats {
  rawCount: number;
  keptCount: number;
  invalidCount: number;
  nonMonotonicCount: number;
}

// 增加超长文档的调试信息，方式超长文档同步实效。
interface DebugGlobal {
  __FLOATBOAT_SPLIT_PREVIEW_DEBUG__?: boolean;
  __FLOATBOAT_MARKDOWN_DEBUG__?: boolean;
  localStorage?: { getItem(key: string): string | null };
}

const VIEWPORT_BIAS = 0.15;
const BOTTOM_SNAP_EPSILON = 1;
const SYNC_UNLOCK_MS = 100;

// 显示开启preview的调试信息，方便开发者调试预览同步问题
// localStorage.setItem("floatboat:split-preview-debug", "1")  //开启
// localStorage.setItem("floatboat:split-preview-debug", "0") //关闭
function isDebugEnabled(): boolean {
  const debugGlobal = globalThis as DebugGlobal;
  if (
    debugGlobal.__FLOATBOAT_SPLIT_PREVIEW_DEBUG__ === true ||
    debugGlobal.__FLOATBOAT_MARKDOWN_DEBUG__ === true
  ) {
    return true;
  }

  try {
    return (
      debugGlobal.localStorage?.getItem("floatboat:split-preview-debug") === "1" ||
      debugGlobal.localStorage?.getItem("floatboat:markdown-debug") === "1"
    );
  } catch {
    return false;
  }
}

function debugSplitPreview(message: string, details: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  console.debug(`[NexusSplitPreview] ${message}`, details);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function previewTopInScroller(element: HTMLElement, scroller: HTMLElement): number {
  const scrollerRect = scroller.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return elementRect.top - scrollerRect.top + scroller.scrollTop;
}

function readAnchor(
  element: HTMLElement,
  scroller: HTMLElement,
  resolveLineAtOffset: (offset: number) => number
): ScrollSyncAnchor | null {
  const rawLine = Number(element.dataset.sourceLine);
  const offset = Number(element.dataset.sourceOffset);
  const rawEndOffset = Number(element.dataset.sourceEndOffset);
  if (!Number.isFinite(offset) || offset < 0) return null;
  const line = Number.isFinite(rawLine) && rawLine >= 1 ? rawLine : resolveLineAtOffset(offset);
  if (!Number.isFinite(line) || line < 1) return null;
  const previewTop = previewTopInScroller(element, scroller);
  if (!Number.isFinite(previewTop) || previewTop < 0) return null;
  return {
    line: Math.trunc(line),
    offset: Math.trunc(offset),
    endOffset: Number.isFinite(rawEndOffset) && rawEndOffset > offset ? Math.trunc(rawEndOffset) : Math.trunc(offset),
    previewTop,
    previewBottom: previewTop + element.getBoundingClientRect().height,
    blockType: element.dataset.sourceType ?? element.tagName.toLowerCase(),
  };
}

function collectAnchors(
  scroller: HTMLElement,
  resolveLineAtOffset: (offset: number) => number
): { anchors: ScrollSyncAnchor[]; stats: AnchorStats } {
  const elements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-source-line][data-source-offset]"));
  const raw: ScrollSyncAnchor[] = [];
  let invalidCount = 0;
  for (const element of elements) {
    const anchor = readAnchor(element, scroller, resolveLineAtOffset);
    if (anchor) raw.push(anchor);
    else invalidCount++;
  }

  raw.sort((left, right) => left.previewTop - right.previewTop || left.offset - right.offset);

  const anchors: ScrollSyncAnchor[] = [];
  let nonMonotonicCount = 0;
  for (const anchor of raw) {
    const previous = anchors[anchors.length - 1];
    if (
      previous &&
      (anchor.offset < previous.offset || anchor.previewTop < previous.previewTop)
    ) {
      nonMonotonicCount++;
      continue;
    }
    if (
      previous &&
      anchor.offset === previous.offset &&
      Math.abs(anchor.previewTop - previous.previewTop) <= 1
    ) {
      continue;
    }
    anchors.push(anchor);
  }

  return {
    anchors,
    stats: {
      rawCount: elements.length,
      keptCount: anchors.length,
      invalidCount,
      nonMonotonicCount,
    },
  };
}

function findAnchorByPreviewTop(anchors: readonly ScrollSyncAnchor[], previewTop: number): ScrollSyncAnchor | null {
  if (anchors.length === 0) return null;
  let selected = anchors[0];
  for (const anchor of anchors) {
    if (anchor.previewTop > previewTop) break;
    selected = anchor;
  }
  return selected;
}

function findAnchorBySourceOffset(anchors: readonly ScrollSyncAnchor[], offset: number): ScrollSyncAnchor | null {
  if (anchors.length === 0 || !Number.isFinite(offset)) return null;
  let selected = anchors[0];
  for (const anchor of anchors) {
    if (anchor.offset > offset) break;
    selected = anchor;
  }
  return selected;
}

function mapInsideAnchorToPreviewTop(anchor: ScrollSyncAnchor, sourceOffset: number): number {
  const previewBottom = anchor.previewBottom ?? anchor.previewTop;
  if (anchor.endOffset <= anchor.offset || previewBottom <= anchor.previewTop) return anchor.previewTop;
  const ratio = clamp((sourceOffset - anchor.offset) / (anchor.endOffset - anchor.offset), 0, 1);
  return anchor.previewTop + (previewBottom - anchor.previewTop) * ratio;
}

function mapInsideAnchorToSourceOffset(anchor: ScrollSyncAnchor, previewTop: number): number {
  const previewBottom = anchor.previewBottom ?? anchor.previewTop;
  if (anchor.endOffset <= anchor.offset || previewBottom <= anchor.previewTop) return anchor.offset;
  const ratio = clamp((previewTop - anchor.previewTop) / (previewBottom - anchor.previewTop), 0, 1);
  return anchor.offset + (anchor.endOffset - anchor.offset) * ratio;
}

export function createSplitPreview(options: SplitPreviewOptions): SplitPreview {
  const element = document.createElement("aside");
  element.className = "split-preview";
  element.setAttribute("aria-label", "Markdown preview");
  element.hidden = true;

  const content = document.createElement("div");
  content.className = "split-preview__content";
  element.appendChild(content);

  let open = false;
  let anchors: ScrollSyncAnchor[] = [];
  let anchorStats: AnchorStats = { rawCount: 0, keptCount: 0, invalidCount: 0, nonMonotonicCount: 0 };
  let syncingFrom: "preview" | "source" | null = null;
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  let previewFrame: number | null = null;
  let sourceFrame: number | null = null;
  let refreshFrame: number | null = null;
  let sourceScrollElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let maintainSourceBottom = false;

  const lock = (from: "preview" | "source") => {
    syncingFrom = from;
    if (unlockTimer !== undefined) clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      unlockTimer = undefined;
      syncingFrom = null;
    }, SYNC_UNLOCK_MS);
  };

  const debugSync = (
    direction: "preview->editor" | "editor->preview",
    details: Record<string, unknown>
  ) => {
    const sourceEl = options.editor.getScrollElement();
    const sourceMaxScroll = options.editor.getScrollMax();
    const previewMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    debugSplitPreview("scroll-sync", {
      direction,
      sourceScrollTop: options.editor.getScrollTop(),
      sourceMaxScroll,
      sourceBottomDistance: sourceMaxScroll - options.editor.getScrollTop(),
      previewScrollTop: element.scrollTop,
      previewMaxScroll,
      previewBottomDistance: previewMaxScroll - element.scrollTop,
      realAnchorCount: anchors.length,
      firstRealAnchor: anchors[0] ?? null,
      lastRealAnchor: anchors[anchors.length - 1] ?? null,
      sourceScrollerIsEditorScrollElement: sourceScrollElement !== null && sourceScrollElement === sourceEl,
      anchorStats,
      ...details,
    });
  };

  const refreshAnchors = () => {
    refreshFrame = null;
    if (!open) return;
    const result = collectAnchors(element, (offset) => options.editor.getLineNumberAtPosition(offset));
    anchors = result.anchors;
    anchorStats = result.stats;
    debugSplitPreview("anchors-refresh", {
      ...anchorStats,
      firstRealAnchor: anchors[0] ?? null,
      lastRealAnchor: anchors[anchors.length - 1] ?? null,
    });
  };

  const scheduleRefreshAnchors = () => {
    if (refreshFrame !== null) return;
    refreshFrame = requestAnimationFrame(refreshAnchors);
  };

  const update = () => {
    if (!open) return;
    content.replaceChildren(options.renderPreview());
    refreshAnchors();
    scheduleRefreshAnchors();
  };

  const isPreviewAtBottom = () => {
    const previewMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    return previewMaxScroll - element.scrollTop <= BOTTOM_SNAP_EPSILON;
  };

  const stickBothSidesToBottom = (reason: string) => {
    const sourceEl = options.editor.getScrollElement();
    if (!open || !sourceEl || !maintainSourceBottom || !isPreviewAtBottom()) return;
    const sourceMaxScroll = options.editor.getScrollMax();
    const previewMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    lock("source");
    options.editor.setScrollTop(sourceMaxScroll);
    element.scrollTop = previewMaxScroll;
    debugSync("editor->preview", {
      reason,
      targetBeforeClamp: sourceMaxScroll,
      targetAfterClamp: options.editor.getScrollTop(),
      usedBottomSnap: true,
      usedAnchorMapping: false,
      maintainedSourceBottom: true,
    });
  };

  const syncPreviewToEditor = () => {
    if (!open || syncingFrom === "source") return;
    const sourceEl = options.editor.getScrollElement();
    if (!sourceEl) return;
    const previewMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const sourceMaxScroll = options.editor.getScrollMax();
    const previewBottomDistance = previewMaxScroll - element.scrollTop;
    const isPreviewActuallyAtBottom = previewBottomDistance <= BOTTOM_SNAP_EPSILON;

    if (isPreviewActuallyAtBottom) {
      maintainSourceBottom = true;
      lock("preview");
      options.editor.setScrollTop(sourceMaxScroll);
      debugSync("preview->editor", {
        isPreviewActuallyAtBottom,
        isSourceActuallyAtBottom: false,
        probeTop: null,
        selectedLine: null,
        selectedAnchor: null,
        targetBeforeClamp: sourceMaxScroll,
        targetAfterClamp: options.editor.getScrollTop(),
        wasClampedToBottom: false,
        usedBottomSnap: true,
        usedAnchorMapping: false,
      });
      return;
    }

    maintainSourceBottom = false;
    const probeTop = element.scrollTop + element.clientHeight * VIEWPORT_BIAS;
    const anchor = findAnchorByPreviewTop(anchors, probeTop);
    if (!anchor) {
      debugSync("preview->editor", {
        isPreviewActuallyAtBottom,
        probeTop,
        selectedLine: null,
        selectedAnchor: null,
        usedBottomSnap: false,
        usedAnchorMapping: false,
        reason: "missing-preview-anchor",
      });
      return;
    }

    const mappedOffset =
      probeTop >= anchor.previewTop && probeTop <= (anchor.previewBottom ?? anchor.previewTop)
        ? mapInsideAnchorToSourceOffset(anchor, probeTop)
        : anchor.offset;
    const block = options.editor.getLineBlockAtPosition(mappedOffset);
    if (!block) return;

    const targetBeforeClamp = block.top - sourceEl.clientHeight * VIEWPORT_BIAS;
    const targetAfterClamp = clamp(targetBeforeClamp, 0, sourceMaxScroll);
    const wasClampedToBottom = targetAfterClamp === sourceMaxScroll && targetBeforeClamp > sourceMaxScroll;
    if (wasClampedToBottom) {
      debugSync("preview->editor", {
        isPreviewActuallyAtBottom,
        probeTop,
        selectedLine: anchor.line,
        selectedAnchor: anchor,
        mappedOffset,
        targetBeforeClamp,
        targetAfterClamp,
        wasClampedToBottom,
        usedBottomSnap: false,
        usedAnchorMapping: false,
        reason: "target-overflow",
      });
      return;
    }

    lock("preview");
    options.editor.setScrollTop(targetAfterClamp);
    debugSync("preview->editor", {
      isPreviewActuallyAtBottom,
      probeTop,
      selectedLine: anchor.line,
      selectedAnchor: anchor,
      mappedOffset,
      targetBeforeClamp,
      targetAfterClamp,
      wasClampedToBottom,
      usedBottomSnap: false,
      usedAnchorMapping: true,
    });
  };

  const syncEditorToPreview = () => {
    if (!open || syncingFrom === "preview") return;
    const sourceEl = options.editor.getScrollElement();
    if (!sourceEl) return;
    const sourceMaxScroll = options.editor.getScrollMax();
    const previewMaxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const sourceBottomDistance = sourceMaxScroll - sourceEl.scrollTop;
    const isSourceActuallyAtBottom = sourceBottomDistance <= BOTTOM_SNAP_EPSILON;

    if (isSourceActuallyAtBottom) {
      maintainSourceBottom = true;
      lock("source");
      element.scrollTop = previewMaxScroll;
      debugSync("editor->preview", {
        isSourceActuallyAtBottom,
        isPreviewActuallyAtBottom: false,
        probeTop: null,
        selectedLine: null,
        selectedAnchor: null,
        targetBeforeClamp: previewMaxScroll,
        targetAfterClamp: element.scrollTop,
        wasClampedToBottom: false,
        usedBottomSnap: true,
        usedAnchorMapping: false,
      });
      return;
    }

    maintainSourceBottom = false;
    const probeTop = sourceEl.scrollTop + sourceEl.clientHeight * VIEWPORT_BIAS;
    const block = options.editor.getLineBlockAtHeight(probeTop);
    if (!block) return;
    const line = options.editor.getLineNumberAtPosition(block.from);
    const anchor = findAnchorBySourceOffset(anchors, block.from);
    if (!anchor) {
      debugSync("editor->preview", {
        isSourceActuallyAtBottom,
        probeTop,
        selectedLine: line,
        selectedAnchor: null,
        usedBottomSnap: false,
        usedAnchorMapping: false,
        reason: "missing-source-anchor",
      });
      return;
    }

    const mappedPreviewTop =
      block.from >= anchor.offset && block.from <= anchor.endOffset
        ? mapInsideAnchorToPreviewTop(anchor, block.from)
        : anchor.previewTop;
    const targetBeforeClamp = mappedPreviewTop - element.clientHeight * VIEWPORT_BIAS;
    const targetAfterClamp = clamp(targetBeforeClamp, 0, previewMaxScroll);
    const wasClampedToBottom = targetAfterClamp === previewMaxScroll && targetBeforeClamp > previewMaxScroll;
    if (wasClampedToBottom) {
      debugSync("editor->preview", {
        isSourceActuallyAtBottom,
        probeTop,
        selectedLine: line,
        selectedAnchor: anchor,
        mappedPreviewTop,
        targetBeforeClamp,
        targetAfterClamp,
        wasClampedToBottom,
        usedBottomSnap: false,
        usedAnchorMapping: false,
        reason: "target-overflow",
      });
      return;
    }

    lock("source");
    element.scrollTop = targetAfterClamp;
    debugSync("editor->preview", {
      isSourceActuallyAtBottom,
      probeTop,
      selectedLine: line,
      selectedAnchor: anchor,
      mappedPreviewTop,
      targetBeforeClamp,
      targetAfterClamp,
      wasClampedToBottom,
      usedBottomSnap: false,
      usedAnchorMapping: true,
    });
  };

  const schedulePreviewSync = () => {
    if (previewFrame !== null) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      syncPreviewToEditor();
    });
  };

  const scheduleSourceSync = () => {
    if (sourceFrame !== null) return;
    sourceFrame = requestAnimationFrame(() => {
      sourceFrame = null;
      syncEditorToPreview();
    });
  };

  const detachSourceScroller = () => {
    sourceScrollElement?.removeEventListener("scroll", scheduleSourceSync);
    sourceScrollElement = null;
  };

  const attachSourceScroller = () => {
    detachSourceScroller();
    sourceScrollElement = options.editor.getScrollElement();
    sourceScrollElement?.addEventListener("scroll", scheduleSourceSync);
  };

  const cancelFrames = () => {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    if (sourceFrame !== null) cancelAnimationFrame(sourceFrame);
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    previewFrame = null;
    sourceFrame = null;
    refreshFrame = null;
  };

  const attachLayoutObservers = () => {
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        scheduleRefreshAnchors();
        const sourceEl = options.editor.getScrollElement();
        const sourceChanged = entries.some((entry) => entry.target === sourceEl);
        if (!sourceChanged) return;
        if (maintainSourceBottom) {
          stickBothSidesToBottom("source-resize-maintain-bottom");
          return;
        }
        if (syncingFrom === "preview") {
          setTimeout(scheduleSourceSync, SYNC_UNLOCK_MS + 20);
        } else {
          scheduleSourceSync();
        }
      });
      resizeObserver.observe(element);
      resizeObserver.observe(content);
      const sourceEl = options.editor.getScrollElement();
      if (sourceEl) resizeObserver.observe(sourceEl);
    }
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(scheduleRefreshAnchors);
      mutationObserver.observe(content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "style", "class"],
      });
    }
    content.addEventListener("load", scheduleRefreshAnchors, true);
    window.addEventListener("resize", scheduleRefreshAnchors);
  };

  const detachLayoutObservers = () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
    content.removeEventListener("load", scheduleRefreshAnchors, true);
    window.removeEventListener("resize", scheduleRefreshAnchors);
  };

  const setOpen = (next: boolean) => {
    if (open === next) return;
    open = next;
    element.hidden = !open;
    options.editorColumn.classList.toggle("editor-column--split-preview", open);

    if (open) {
      update();
      attachSourceScroller();
      attachLayoutObservers();
      scheduleRefreshAnchors();
      return;
    }

    detachLayoutObservers();
    detachSourceScroller();
    cancelFrames();
    if (unlockTimer !== undefined) clearTimeout(unlockTimer);
    unlockTimer = undefined;
    syncingFrom = null;
    maintainSourceBottom = false;
  };

  element.addEventListener("scroll", schedulePreviewSync);

  return {
    element,
    isOpen() {
      return open;
    },
    setOpen,
    toggle() {
      setOpen(!open);
      return open;
    },
    update,
    destroy() {
      setOpen(false);
      element.removeEventListener("scroll", schedulePreviewSync);
      element.remove();
    },
  };
}
