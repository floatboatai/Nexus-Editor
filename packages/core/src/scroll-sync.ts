import type { EditorAPI } from "./types";
import { SOURCE_MAP_FROM_ATTR, SOURCE_MAP_TO_ATTR } from "./html-source-map";

/**
 * Bidirectional scroll synchronisation between the editor and a rendered
 * HTML preview (ROADMAP #13).
 *
 * The preview element is expected to contain block elements stamped with
 * `data-nexus-from` / `data-nexus-to` source offsets — the output of
 * `editor.exportHTML({ sourceMap: true })`. Those blocks become *anchors*:
 * known correspondences between a markdown source range and a pixel range
 * in the preview. Scroll positions between anchors are linearly
 * interpolated, so a 40-line code fence that renders 200px tall still maps
 * smoothly instead of snapping block-to-block.
 *
 * Feedback-loop protection: whichever pane received the last user scroll
 * becomes the "driver" for a short window; scroll events fired on the
 * other pane (as a result of us programmatically scrolling it) are ignored
 * until the window lapses. Without this, editor→preview→editor echoes make
 * both panes fight and judder.
 */

/** One preview block: a markdown source range mapped to a pixel range. */
export interface ScrollSyncAnchor {
  /** Start offset of the block in the markdown source. */
  from: number;
  /** End offset (exclusive) of the block in the markdown source. */
  to: number;
  /** Top of the block, in preview content coordinates (scrollTop space). */
  top: number;
  /** Bottom of the block, in preview content coordinates. */
  bottom: number;
}

/**
 * Read the anchor list out of a rendered preview container. Coordinates are
 * measured relative to the container's scroll content (i.e. directly
 * comparable to `container.scrollTop`), so the container's own CSS
 * `position` does not matter.
 */
export function collectScrollSyncAnchors(container: HTMLElement): ScrollSyncAnchor[] {
  const containerTop = container.getBoundingClientRect().top;
  const scrollTop = container.scrollTop;
  const anchors: ScrollSyncAnchor[] = [];

  const blocks = container.querySelectorAll<HTMLElement>(`[${SOURCE_MAP_FROM_ATTR}]`);
  for (const el of Array.from(blocks)) {
    const from = Number(el.getAttribute(SOURCE_MAP_FROM_ATTR));
    const to = Number(el.getAttribute(SOURCE_MAP_TO_ATTR));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;

    const rect = el.getBoundingClientRect();
    anchors.push({
      from,
      to,
      top: rect.top - containerTop + scrollTop,
      bottom: rect.bottom - containerTop + scrollTop
    });
  }

  anchors.sort((a, b) => a.from - b.from || a.to - b.to);
  return anchors;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Linear interpolation guarded against zero-width segments. */
function interpolate(value: number, fromLo: number, fromHi: number, toLo: number, toHi: number): number {
  const span = fromHi - fromLo;
  const f = span > 0 ? clamp01((value - fromLo) / span) : 0;
  return toLo + f * (toHi - toLo);
}

/**
 * Map a markdown source offset to a preview scroll position (content
 * coordinates). Inside an anchor the offset interpolates across the block's
 * pixel height; in the gap between two anchors it interpolates across the
 * whitespace separating them. Offsets before the first anchor map toward 0
 * so the two documents reach their tops together.
 */
export function sourceOffsetToPreviewTop(anchors: ScrollSyncAnchor[], offset: number): number | null {
  if (anchors.length === 0) return null;

  const first = anchors[0];
  if (offset <= first.from) {
    return interpolate(offset, 0, first.from, 0, first.top);
  }

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];

    if (offset <= anchor.to) {
      return interpolate(offset, anchor.from, anchor.to, anchor.top, anchor.bottom);
    }

    const next = anchors[i + 1];
    if (next && offset < next.from) {
      return interpolate(offset, anchor.to, next.from, anchor.bottom, next.top);
    }
  }

  return anchors[anchors.length - 1].bottom;
}

/**
 * Inverse of {@link sourceOffsetToPreviewTop}: map a preview scroll position
 * back to the markdown source offset that should sit at the top of the
 * editor viewport.
 */
export function previewTopToSourceOffset(anchors: ScrollSyncAnchor[], top: number): number | null {
  if (anchors.length === 0) return null;

  const first = anchors[0];
  if (top <= first.top) {
    return Math.round(interpolate(top, 0, first.top, 0, first.from));
  }

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];

    if (top <= anchor.bottom) {
      return Math.round(interpolate(top, anchor.top, anchor.bottom, anchor.from, anchor.to));
    }

    const next = anchors[i + 1];
    if (next && top < next.top) {
      return Math.round(interpolate(top, anchor.bottom, next.top, anchor.to, next.from));
    }
  }

  return anchors[anchors.length - 1].to;
}

export interface ScrollSyncOptions {
  editor: EditorAPI;
  /** Scrollable element containing `exportHTML({ sourceMap: true })` output. */
  preview: HTMLElement;
}

export interface ScrollSync {
  /**
   * Drop the cached anchor geometry and re-align the preview to the
   * editor's current position. Call after replacing the preview's HTML —
   * the old pixel ranges are meaningless against the new DOM.
   */
  refresh(): void;
  destroy(): void;
}

/**
 * How long (ms) a pane stays the scroll "driver" after its last user
 * scroll. Echo events on the passive pane are ignored inside this window;
 * each further scroll on the driving pane extends it, so a continuous
 * wheel gesture never flips drivers mid-way.
 */
const LOCK_DURATION_MS = 150;

/**
 * Wire bidirectional sync between an editor and a preview container.
 * Returns a handle whose `refresh()` the host must call after replacing the
 * preview's HTML, and whose `destroy()` detaches every listener.
 */
export function createScrollSync(options: ScrollSyncOptions): ScrollSync {
  const { editor, preview } = options;

  let destroyed = false;
  let anchors: ScrollSyncAnchor[] | null = null;
  let driver: "editor" | "preview" | null = null;
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  let editorFrame: number | null = null;
  let previewFrame: number | null = null;

  function getAnchors(): ScrollSyncAnchor[] {
    if (!anchors) anchors = collectScrollSyncAnchors(preview);
    return anchors;
  }

  function acquire(who: "editor" | "preview"): boolean {
    if (driver !== null && driver !== who) return false;
    driver = who;
    if (unlockTimer) clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      driver = null;
      unlockTimer = undefined;
    }, LOCK_DURATION_MS);
    return true;
  }

  function alignPreviewToEditor(): void {
    if (destroyed || preview.hidden) return;
    const target = sourceOffsetToPreviewTop(getAnchors(), editor.getScrollAnchor());
    if (target === null) return;
    // Sub-pixel writes still fire scroll events; skip no-op alignments.
    if (Math.abs(preview.scrollTop - target) > 1) {
      preview.scrollTop = target;
    }
  }

  function alignEditorToPreview(): void {
    if (destroyed || preview.hidden) return;
    const offset = previewTopToSourceOffset(getAnchors(), preview.scrollTop);
    if (offset === null) return;
    editor.scrollToAnchor(offset);
  }

  // rAF-coalesced handlers: scroll events arrive faster than frames are
  // painted; measuring anchors and writing scrollTop more than once per
  // frame is wasted layout work. The hidden check keeps a closed preview
  // from paying anchor measurement for every editor scroll.
  function handleEditorScroll(): void {
    if (destroyed || preview.hidden || !acquire("editor")) return;
    if (editorFrame !== null) return;
    editorFrame = requestAnimationFrame(() => {
      editorFrame = null;
      alignPreviewToEditor();
    });
  }

  function handlePreviewScroll(): void {
    if (destroyed || preview.hidden || !acquire("preview")) return;
    if (previewFrame !== null) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      alignEditorToPreview();
    });
  }

  // Window resize reflows the preview blocks; the cached pixel ranges are
  // stale until the next measurement. (Document edits need no listener
  // here: anchors derive purely from the preview DOM, which only changes
  // when the host re-renders and calls refresh().)
  function handleResize(): void {
    anchors = null;
  }

  editor.on("scroll", handleEditorScroll);
  preview.addEventListener("scroll", handlePreviewScroll, { passive: true });
  window.addEventListener("resize", handleResize);

  return {
    refresh() {
      if (destroyed) return;
      anchors = null;
      alignPreviewToEditor();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("scroll", handleEditorScroll);
      preview.removeEventListener("scroll", handlePreviewScroll);
      window.removeEventListener("resize", handleResize);
      if (unlockTimer) clearTimeout(unlockTimer);
      if (editorFrame !== null) cancelAnimationFrame(editorFrame);
      if (previewFrame !== null) cancelAnimationFrame(previewFrame);
      anchors = null;
    }
  };
}
