import type { EditorAPI, ScrollInfo } from "@floatboat/nexus-core";
import type { PreviewPanel } from "./preview-panel";

/**
 * Two-way scroll sync between the editor and a preview panel using a percent
 * heuristic — the editor's `scrollTop / (scrollHeight - clientHeight)` maps
 * directly to the preview's scroll position. Precise line-anchor sync would
 * require injecting `data-source-line` markers into the exported HTML; this
 * approximation is good enough for a demo and keeps the preview renderer
 * dependency-free.
 *
 * A short **time-window lock** (150 ms) swallows the echo scroll events that
 * browsers fire in response to programmatic scrolling. A microtask-scoped
 * boolean flag is not enough here: CM6's `scroll` event is rAF-coalesced
 * (fires on the next animation frame), while the preview's native DOM scroll
 * fires synchronously — a microtask releases the lock before the rAF echo
 * arrives, and the two panels chase each other into a jitter loop. The timed
 * lock is coarse but deterministic: after any programmatic scroll, inbound
 * scroll events are ignored for 150 ms — long enough for the browser to
 * flush echoes, short enough that a fresh user scroll still feels responsive.
 */
const LOCK_MS = 150;

export function wireScrollSync(editor: EditorAPI, preview: PreviewPanel): () => void {
  let lockTimer: ReturnType<typeof setTimeout> | null = null;

  function acquireLock() {
    if (lockTimer !== null) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { lockTimer = null; }, LOCK_MS);
  }
  function isLocked(): boolean {
    return lockTimer !== null;
  }

  function editorPercent(info: ScrollInfo): number {
    const denom = info.scrollHeight - info.clientHeight;
    if (denom <= 0) return 0;
    return Math.max(0, Math.min(1, info.scrollTop / denom));
  }

  const handleEditorScroll = (info: ScrollInfo) => {
    if (isLocked()) return;
    acquireLock();
    preview.scrollToPercent(editorPercent(info));
  };

  const unsubscribePreview = preview.onScroll((percent) => {
    if (isLocked()) return;
    acquireLock();
    const docLen = editor.getDocument().length;
    if (docLen === 0) return;
    const pos = Math.round(docLen * Math.max(0, Math.min(1, percent)));
    editor.scrollPosIntoView(pos, { align: "start" });
  });

  editor.on("scroll", handleEditorScroll);

  return () => {
    editor.off("scroll", handleEditorScroll);
    unsubscribePreview();
    if (lockTimer !== null) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  };
}
