import type { EditorAPI } from "@floatboat/nexus-core";

export interface PreviewPanel {
  element: HTMLElement;
  update(): void;
  destroy(): void;
  scrollToPercent(percent: number): void;
  getScrollPercent(): number;
  onScroll(handler: (percent: number) => void): () => void;
}

const INITIAL_WIDTH_PX = 480;
const MIN_WIDTH_PX = 240;
const MAX_WIDTH_RATIO = 0.7; // 70% of window

const PANEL_STYLES = `
  width: ${INITIAL_WIDTH_PX}px;
  flex-shrink: 0;
  position: relative;
  border-left: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  overflow-y: auto;
  padding: 24px 32px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: var(--nexus-text, #24292e);
`;

const BODY_STYLES = `
  max-width: 720px;
  margin: 0 auto;
`;

// Hit target for the drag handle is a bit wider than the visible bar so
// grabbing it is forgiving. Visible highlight only appears on hover / drag.
const RESIZER_STYLES = `
  position: absolute;
  top: 0;
  left: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.12s ease;
`;
const RESIZER_ACTIVE_BG = "var(--nexus-accent, #4a9eff)";

/**
 * Minimal split-view HTML preview. Renders the editor's markdown via
 * `editor.exportHTML()` and re-renders on every change. Meant as a scroll-sync
 * demo target — hosts that want a production preview should render off the
 * mdast themselves for finer control.
 */
export function createPreviewPanel(editor: EditorAPI): PreviewPanel {
  const panel = document.createElement("div");
  panel.className = "nexus-preview-panel";
  panel.style.cssText = PANEL_STYLES;

  const body = document.createElement("div");
  body.style.cssText = BODY_STYLES;
  panel.appendChild(body);

  // --- Resizer (drag handle on the panel's left edge) ---
  const resizer = document.createElement("div");
  resizer.className = "nexus-preview-resizer";
  resizer.style.cssText = RESIZER_STYLES;
  resizer.title = "Drag to resize";
  panel.appendChild(resizer);

  let isDragging = false;

  function showHighlight() {
    resizer.style.background = RESIZER_ACTIVE_BG;
  }
  function hideHighlight() {
    if (!isDragging) resizer.style.background = "transparent";
  }
  resizer.addEventListener("mouseenter", showHighlight);
  resizer.addEventListener("mouseleave", hideHighlight);

  function beginDrag(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    showHighlight();
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;
    const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;

    // Lock cursor and disable text selection globally while dragging so the
    // pointer stays as col-resize even when it leaves the resizer element
    // and the editor doesn't select text as we drag over it.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function onMove(ev: MouseEvent) {
      // Panel sits at the right of the editor. Dragging left (dx < 0)
      // widens the panel; dragging right narrows it.
      const dx = ev.clientX - startX;
      const next = Math.max(MIN_WIDTH_PX, Math.min(maxWidth, startWidth - dx));
      panel.style.width = `${next}px`;
    }
    function onUp() {
      isDragging = false;
      hideHighlight();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  resizer.addEventListener("mousedown", beginDrag);

  // Double-click resets to the initial width — quick escape hatch if the user
  // dragged too narrow to see anything.
  resizer.addEventListener("dblclick", () => {
    panel.style.width = `${INITIAL_WIDTH_PX}px`;
  });

  // --- Content rendering + scroll bookkeeping ---
  const scrollHandlers = new Set<(percent: number) => void>();

  function update() {
    try {
      body.innerHTML = editor.exportHTML();
    } catch {
      body.textContent = "";
    }
  }

  function getScrollPercent(): number {
    const denom = panel.scrollHeight - panel.clientHeight;
    if (denom <= 0) return 0;
    return panel.scrollTop / denom;
  }

  function scrollToPercent(percent: number) {
    const denom = panel.scrollHeight - panel.clientHeight;
    if (denom <= 0) return;
    const clamped = Math.max(0, Math.min(1, percent));
    panel.scrollTop = denom * clamped;
  }

  function handleScroll() {
    const percent = getScrollPercent();
    for (const handler of scrollHandlers) handler(percent);
  }

  panel.addEventListener("scroll", handleScroll, { passive: true });
  editor.on("change", update);
  update();

  return {
    element: panel,
    update,
    scrollToPercent,
    getScrollPercent,
    onScroll(handler) {
      scrollHandlers.add(handler);
      return () => scrollHandlers.delete(handler);
    },
    destroy() {
      editor.off("change", update);
      panel.removeEventListener("scroll", handleScroll);
      resizer.removeEventListener("mousedown", beginDrag);
      resizer.removeEventListener("mouseenter", showHighlight);
      resizer.removeEventListener("mouseleave", hideHighlight);
      scrollHandlers.clear();
      panel.remove();
    },
  };
}
