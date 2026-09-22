import type { EditorAPI, TocEntry } from "./types";

export interface OutlineUIOptions {
  /**
   * Target DOM element where the outline will be mounted.
   * If not provided, a container element will be created and accessible via `outline.element`.
   */
  container?: HTMLElement;
  /**
   * Custom title formatter for outline entries.
   */
  formatTitle?: (entry: TocEntry) => string;
  /**
   * Callback invoked when an outline item is clicked.
   */
  onItemClick?: (entry: TocEntry) => void;
  /**
   * Placeholder text to display when the document has no headings.
   * Defaults to "No headings in document".
   */
  emptyText?: string;
}

export interface OutlineUI {
  /** The root DOM element of the outline sidebar */
  element: HTMLElement;
  /** Manually refresh the outline contents */
  refresh(): void;
  /** Destroy the outline component and remove all event listeners */
  destroy(): void;
}

const OUTLINE_STYLES = `
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: 320px;
  padding: 12px 8px;
  overflow-y: auto;
  font-family: system-ui, -apple-system, sans-serif;
  user-select: none;
`;

const OUTLINE_EMPTY_STYLES = `
  padding: 16px 8px;
  font-size: 13px;
  color: var(--nexus-text-muted, #9ca3af);
  text-align: center;
  font-style: italic;
`;

const ITEM_BASE_STYLES = `
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  margin: 1px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--nexus-text, #374151);
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/**
 * Creates an interactive document outline (TOC) sidebar that automatically
 * tracks document headings, highlights the currently reading chapter, and
 * allows smooth jumping on click.
 */
export function createOutlineUI(editor: EditorAPI, options: OutlineUIOptions = {}): OutlineUI {
  const container = options.container ?? document.createElement("div");
  container.className = "nexus-outline-sidebar";
  container.dataset.testId = "nexus-outline-sidebar";
  container.style.cssText = OUTLINE_STYLES;

  let currentEntries: TocEntry[] = [];
  let activeIndex = -1;

  function findActiveHeadingIndex(entries: TocEntry[], cursor: number): number {
    if (entries.length === 0) return -1;
    let active = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].from <= cursor) {
        active = i;
      } else {
        break;
      }
    }
    return active >= 0 ? active : 0;
  }

  function updateActiveHighlight(): void {
    const sel = editor.getSelection();
    const cursor = sel ? sel.anchor : 0;
    const newActiveIndex = findActiveHeadingIndex(currentEntries, cursor);

    if (newActiveIndex === activeIndex) return;
    activeIndex = newActiveIndex;

    const items = container.querySelectorAll<HTMLElement>(".nexus-outline-item");
    items.forEach((item, idx) => {
      const isActive = idx === activeIndex;
      item.dataset.active = String(isActive);
      if (isActive) {
        item.style.background = "var(--nexus-accent-subtle, rgba(9, 105, 218, 0.08))";
        item.style.color = "var(--nexus-accent, #0969da)";
        item.style.fontWeight = "600";
      } else {
        item.style.background = "transparent";
        item.style.color = "var(--nexus-text, #374151)";
        item.style.fontWeight = "400";
      }
    });
  }

  function render(): void {
    container.innerHTML = "";
    currentEntries = editor.getTableOfContents();

    if (currentEntries.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "nexus-outline-empty";
      emptyEl.style.cssText = OUTLINE_EMPTY_STYLES;
      emptyEl.textContent = options.emptyText ?? "No headings in document";
      container.appendChild(emptyEl);
      activeIndex = -1;
      return;
    }

    const sel = editor.getSelection();
    activeIndex = findActiveHeadingIndex(currentEntries, sel ? sel.anchor : 0);

    currentEntries.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "nexus-outline-item";
      item.dataset.testId = `outline-item-${index}`;
      item.dataset.level = String(entry.level);
      item.style.cssText = ITEM_BASE_STYLES;

      // Hierarchical indentation (H1 = 0px, H2 = 12px, H3 = 24px, etc.)
      const indentPx = Math.max(0, entry.level - 1) * 14;
      item.style.paddingLeft = `${10 + indentPx}px`;

      const title = options.formatTitle ? options.formatTitle(entry) : entry.text || "(Untitled)";
      item.textContent = title;
      item.title = title;

      const isActive = index === activeIndex;
      item.dataset.active = String(isActive);
      if (isActive) {
        item.style.background = "var(--nexus-accent-subtle, rgba(9, 105, 218, 0.08))";
        item.style.color = "var(--nexus-accent, #0969da)";
        item.style.fontWeight = "600";
      }

      item.addEventListener("mouseenter", () => {
        if (index !== activeIndex) {
          item.style.background = "var(--nexus-bg-subtle, #f3f4f6)";
        }
      });
      item.addEventListener("mouseleave", () => {
        if (index !== activeIndex) {
          item.style.background = "transparent";
        }
      });

      item.addEventListener("click", () => {
        editor.setSelection(entry.from);
        editor.focus();
        options.onItemClick?.(entry);
        updateActiveHighlight();
      });

      container.appendChild(item);
    });
  }

  const onDocChange = () => {
    render();
  };

  const onSelectionChange = () => {
    updateActiveHighlight();
  };

  editor.on("change", onDocChange);
  editor.on("selectionChange", onSelectionChange);

  // Initial render
  render();

  return {
    element: container,
    refresh() {
      render();
    },
    destroy() {
      editor.off("change", onDocChange);
      editor.off("selectionChange", onSelectionChange);
      container.remove();
    },
  };
}
