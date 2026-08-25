import type { EditorAPI, TocEntry } from "@floatboat/nexus-core";

export interface OutlinePanel {
  element: HTMLElement;
  setVisible(visible: boolean): void;
  update(): void;
  destroy(): void;
}

const PANEL_STYLES = `
  width: var(--nexus-outline-panel-width, 220px);
  min-height: 0;
  flex-shrink: 0;
  border-right: var(--nexus-outline-panel-border, 1px solid var(--nexus-border, #eee));
  background: var(--nexus-bg, #fff);
  overflow-y: auto;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
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
`;

const LIST_STYLES = `
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
`;

const ITEM_BASE = `
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 4px 14px;
  color: var(--nexus-text, #24292e);
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  transition: background 0.1s;
`;

const EMPTY_STYLES = `
  padding: 16px 14px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 12px;
  font-style: italic;
`;

export function createOutlinePanel(editor: EditorAPI): OutlinePanel {
  const panel = document.createElement("div");
  panel.className = "nexus-outline-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  header.textContent = "Outline";

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;

  panel.append(header, list);

  let visible = true;
  let dirty = false;
  let destroyed = false;
  let hasRendered = false;
  let currentEntries: readonly TocEntry[] = [];

  function hasSameStructure(entries: readonly TocEntry[]): boolean {
    return hasRendered && entries.length === currentEntries.length && entries.every((entry, index) => {
      const current = currentEntries[index];
      return current?.level === entry.level && current.text === entry.text;
    });
  }

  function renderItems(entries: readonly TocEntry[]) {
    const structureIsStable = hasSameStructure(entries);
    currentEntries = entries;
    if (structureIsStable) return;
    hasRendered = true;

    const fragment = document.createDocumentFragment();

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent = "No headings";
      fragment.append(empty);
      list.replaceChildren(fragment);
      return;
    }

    entries.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.outlineIndex = String(index);
      item.textContent = entry.text;
      item.title = entry.text;
      item.style.cssText = ITEM_BASE;
      item.style.paddingLeft = (14 + (entry.level - 1) * 14) + "px";
      item.style.fontWeight = entry.level <= 2 ? "600" : "400";
      item.style.fontSize = entry.level === 1 ? "14px" : "13px";

      fragment.append(item);
    });
    list.replaceChildren(fragment);
  }

  function findItem(event: Event): HTMLButtonElement | null {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== "function") return null;
    const item = (target as Element).closest<HTMLButtonElement>("button[data-outline-index]");
    return item && list.contains(item) ? item : null;
  }

  function handleClick(event: MouseEvent): void {
    const item = findItem(event);
    if (!item) return;
    const entry = currentEntries[Number(item.dataset.outlineIndex)];
    if (!entry) return;
    editor.setSelection(entry.from);
    editor.focus();
  }

  function handlePointerOver(event: PointerEvent): void {
    const item = findItem(event);
    if (item) item.style.background = "var(--nexus-bg-muted, #f0f0f0)";
  }

  function handlePointerOut(event: PointerEvent): void {
    const item = findItem(event);
    if (item) item.style.background = "transparent";
  }

  function render() {
    if (destroyed) return;
    renderItems(editor.getTableOfContents());
    dirty = false;
  }

  function update() {
    if (destroyed) return;
    if (!visible) {
      dirty = true;
      return;
    }
    render();
  }

  function setVisible(next: boolean): void {
    if (destroyed || visible === next) return;
    visible = next;
    if (visible && dirty) render();
  }

  // Initial render + listen for changes
  render();
  list.addEventListener("click", handleClick);
  list.addEventListener("pointerover", handlePointerOver);
  list.addEventListener("pointerout", handlePointerOut);
  editor.on("change", update);

  return {
    element: panel,
    setVisible,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("change", update);
      list.removeEventListener("click", handleClick);
      list.removeEventListener("pointerover", handlePointerOver);
      list.removeEventListener("pointerout", handlePointerOut);
      panel.remove();
    },
  };
}
