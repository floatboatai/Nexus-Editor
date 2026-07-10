import { renderPreviewHtml, type EditorAPI, type ScrollPayload } from "@floatboat/nexus-core";

export interface PreviewPanel {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

const PANEL_STYLES = `
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const HEADER_STYLES = `
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  border-bottom: 1px solid var(--nexus-border, #eee);
  flex-shrink: 0;
  font-family: system-ui, -apple-system, sans-serif;
`;

const CONTENT_STYLES = `
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: var(--nexus-text, #24292e);
  /* Scroll-sync math (findNearestByOffset / findTopmostVisible) reads each
     rendered element's offsetTop and compares it directly against this
     element's own scrollTop. offsetTop is relative to the nearest
     *positioned* ancestor, not the immediate parent — without this, that
     ancestor is <body> (nothing else in the chain sets position), so every
     computed offset is off by "distance from the top of the whole window"
     and scrollTop assignments just clamp to the max, i.e. the pane never
     visibly moves. position: relative makes this element the offsetParent
     for its rendered content, so offsetTop lines up with its own scrollTop. */
  position: relative;
`;

// Minimal baseline typography reusing the demo's existing theme CSS
// variables — not a new stylesheet, just sane defaults so the rendered
// preview isn't unstyled browser-default HTML.
const CONTENT_TYPOGRAPHY = `
  .nexus-preview-content h1, .nexus-preview-content h2, .nexus-preview-content h3,
  .nexus-preview-content h4, .nexus-preview-content h5, .nexus-preview-content h6 {
    font-weight: 600; margin: 1.2em 0 0.5em; line-height: 1.3;
  }
  .nexus-preview-content p, .nexus-preview-content li, .nexus-preview-content td, .nexus-preview-content th {
    /* remark-rehype keeps CommonMark soft line breaks as a literal "\n" in
       the text node (one <p> per blank-line-separated paragraph, exactly per
       spec) rather than a <br>. Default CSS (white-space: normal) collapses
       that newline to a space, so a paragraph typed across several editor
       lines renders as one run-on line in the preview. pre-line preserves
       the newline as a visual line break while still collapsing runs of
       spaces/tabs, so it doesn't reintroduce markdown-source indentation. */
    white-space: pre-line;
  }
  .nexus-preview-content p { margin: 0.6em 0; }
  .nexus-preview-content code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--nexus-bg-subtle, #f4f4f4); border-radius: 4px; padding: 0.1em 0.3em; font-size: 0.9em;
  }
  .nexus-preview-content pre {
    background: var(--nexus-bg-subtle, #f4f4f4); border-radius: 4px; padding: 10px 12px; overflow: auto;
  }
  .nexus-preview-content pre code { background: none; padding: 0; }
  .nexus-preview-content blockquote {
    margin: 0.6em 0; padding: 4px 0 4px 14px; border-left: 3px solid var(--nexus-border, #ddd);
    color: var(--nexus-text-muted, #888);
  }
  .nexus-preview-content table { border-collapse: collapse; margin: 0.6em 0; }
  .nexus-preview-content th, .nexus-preview-content td {
    border: 1px solid var(--nexus-border-subtle, #e2e2e2); padding: 4px 10px; text-align: left;
  }
  .nexus-preview-content a { color: var(--nexus-accent, #0969da); }
`;

let styleInjected = false;
function ensureTypographyStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = CONTENT_TYPOGRAPHY;
  document.head.appendChild(style);
}

interface OffsetEntry {
  offset: number;
  el: HTMLElement;
}

function getOffsetEntries(content: HTMLElement): OffsetEntry[] {
  const entries: OffsetEntry[] = [];
  content.querySelectorAll<HTMLElement>("[data-offset]").forEach((el) => {
    const offset = Number(el.dataset.offset);
    if (Number.isFinite(offset)) entries.push({ offset, el });
  });
  return entries;
}

/** Entries are in document order (renderPreviewHtml walks children in source
 * order), so the last entry with `keyOf(entry) <= threshold` is the nearest
 * one at or before `threshold` — a single forward scan, no sort/search
 * needed. Shared by both scroll directions: `keyOf` is `entry.offset` when
 * matching a source offset, `entry.el.offsetTop` when matching a scrollTop. */
function findLastAtOrBefore(
  entries: OffsetEntry[],
  threshold: number,
  keyOf: (entry: OffsetEntry) => number
): OffsetEntry | null {
  let best: OffsetEntry | null = null;
  for (const entry of entries) {
    if (keyOf(entry) > threshold) break;
    best = entry;
  }
  return best ?? entries[0] ?? null;
}

export function createPreviewPanel(editor: EditorAPI): PreviewPanel {
  ensureTypographyStyle();

  const panel = document.createElement("div");
  panel.className = "nexus-preview-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  header.textContent = "Preview";

  const content = document.createElement("div");
  content.className = "nexus-preview-content";
  content.style.cssText = CONTENT_STYLES;

  panel.append(header, content);

  // Guards against the two scroll bindings below triggering each other in a
  // feedback loop: any programmatic scroll we apply sets this before the
  // write and clears it two animation frames later, so the listener on the
  // *other* side ignores the echo it causes. Two frames, not one: CM6's own
  // scroll tracker (editor.ts) is itself rAF-throttled, so a programmatic
  // `scrollDOM.scrollTop` write here echoes back through its native "scroll"
  // event, into that throttle, and out through our `scroll` listener one
  // frame later than the write itself — a single-frame guard can clear
  // before that echo arrives.
  let isSyncingScroll = false;
  let scrollRafId: number | null = null;

  function withSyncGuard(apply: () => void): void {
    isSyncingScroll = true;
    apply();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isSyncingScroll = false;
      });
    });
  }

  // Both directions align the matched block's top edge only — no sub-block
  // ratio interpolation. `ratio` in the `scroll` event is computed against a
  // single CM6 source line's height, but a rendered preview block can span
  // many source lines (a multi-line paragraph, a whole code fence); reusing
  // that ratio against the DOM block's full height (or vice versa, against
  // `scrollToOffset`'s single-line height) mixes two different-sized units
  // and lands in the wrong place within the block. Block-top alignment is
  // still exact — only the "how far *into* this block" refinement is
  // dropped, and only where it couldn't be computed correctly.
  function onEditorScroll({ offset }: ScrollPayload): void {
    if (isSyncingScroll) return;
    const target = findLastAtOrBefore(getOffsetEntries(content), offset, (e) => e.offset);
    if (!target) return;

    withSyncGuard(() => {
      content.scrollTop = target.el.offsetTop;
    });
  }

  function onPanelScroll(): void {
    if (isSyncingScroll || scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      if (isSyncingScroll) return;

      const target = findLastAtOrBefore(getOffsetEntries(content), content.scrollTop, (e) => e.el.offsetTop);
      if (!target) return;

      withSyncGuard(() => {
        editor.scrollToOffset(target.offset);
      });
    });
  }

  function update(): void {
    content.innerHTML = renderPreviewHtml(editor.getAst());
  }

  // `new URL(href)` with no base throws unless `href` is already a valid
  // absolute URL — this rejects relative/malformed hrefs (e.g. the garbage
  // `href="[Some Note]"` the wiki-link adapter quirk produces, see
  // design.md) instead of letting `window.open` resolve them against the
  // current page's own origin, which in dev is the Vite dev server itself —
  // silently reopening a whole extra copy of this app in a new window.
  function isAbsoluteHttpUrl(href: string): boolean {
    try {
      const url = new URL(href);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  // renderPreviewHtml emits plain <a href> elements. Left unhandled, a click
  // makes Electron's BrowserWindow itself navigate to that URL — there's no
  // will-navigate/setWindowOpenHandler guard in electron/main.ts, so the
  // whole app would be replaced by the target page. Mirror the existing
  // convention from live-preview-renderers.ts's inline link renderer:
  // Ctrl/Cmd-click opens externally via window.open, a plain click is
  // swallowed (preventDefault always, so the app itself never navigates).
  function onContentClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
    if (!anchor) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const href = anchor.getAttribute("href")!;
      if (isAbsoluteHttpUrl(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    }
  }

  update();
  editor.on("change", update);
  editor.on("scroll", onEditorScroll);
  content.addEventListener("scroll", onPanelScroll, { passive: true });
  content.addEventListener("click", onContentClick);

  return {
    element: panel,
    update,
    destroy() {
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      content.removeEventListener("scroll", onPanelScroll);
      content.removeEventListener("click", onContentClick);
      editor.off("change", update);
      editor.off("scroll", onEditorScroll);
      panel.remove();
    },
  };
}
