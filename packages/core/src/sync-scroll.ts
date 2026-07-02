/**
 * Bidirectional scroll-ratio sync for split-pane Markdown preview.
 *
 * Maps scroll position by normalized ratio so hosts can pair the editor's
 * CodeMirror scroll container with any preview pane (HTML export, iframe, etc.)
 * without needing a line-perfect DOM correspondence.
 */

export function computeScrollRatio(element: HTMLElement): number {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) {
    return 0;
  }
  return element.scrollTop / maxScroll;
}

export function applyScrollRatio(element: HTMLElement, ratio: number): void {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) {
    element.scrollTop = 0;
    return;
  }

  const clamped = Math.max(0, Math.min(1, ratio));
  element.scrollTop = clamped * maxScroll;
}

export interface SyncScrollHandle {
  destroy(): void;
}

export interface AttachSyncScrollOptions {
  /** Primary scroll container — typically the editor's scroll DOM. */
  primary: HTMLElement;
  /** Secondary scroll container — typically the preview pane. */
  secondary: HTMLElement;
}

/**
 * Wire bidirectional scroll sync between two overflow containers.
 * Uses a short re-entrancy guard so programmatic scroll updates do not loop.
 */
export function attachSyncScroll(options: AttachSyncScrollOptions): SyncScrollHandle {
  const { primary, secondary } = options;
  let syncing: "primary" | "secondary" | null = null;

  const sync = (
    source: HTMLElement,
    target: HTMLElement,
    from: "primary" | "secondary"
  ): void => {
    if (syncing !== null && syncing !== from) {
      return;
    }

    syncing = from === "primary" ? "secondary" : "primary";
    applyScrollRatio(target, computeScrollRatio(source));
    requestAnimationFrame(() => {
      syncing = null;
    });
  };

  const onPrimaryScroll = (): void => {
    sync(primary, secondary, "primary");
  };
  const onSecondaryScroll = (): void => {
    sync(secondary, primary, "secondary");
  };

  primary.addEventListener("scroll", onPrimaryScroll, { passive: true });
  secondary.addEventListener("scroll", onSecondaryScroll, { passive: true });

  return {
    destroy() {
      primary.removeEventListener("scroll", onPrimaryScroll);
      secondary.removeEventListener("scroll", onSecondaryScroll);
    },
  };
}
