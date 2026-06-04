import type { EditorAPI, TocEntry } from "@floatboat/nexus-core";

export interface OutlinePanel {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

const PANEL_STYLES = `
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  overflow-y: auto;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
`;

const HEADER_STYLES = `
  height: 43px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  border-bottom: 1px solid var(--nexus-border, #eee);
  flex-shrink: 0;
  box-sizing: border-box;
`;

const LIST_STYLES = `
  flex: 1;
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

  function renderItems(entries: TocEntry[]) {
    list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent = "No headings";
      list.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = entry.text;
      item.title = entry.text;
      item.style.cssText = ITEM_BASE;
      item.style.paddingLeft = (14 + (entry.level - 1) * 14) + "px";
      item.style.fontWeight = entry.level <= 2 ? "600" : "400";
      item.style.fontSize = entry.level === 1 ? "14px" : "13px";

      item.addEventListener("mouseenter", () => {
        item.style.background = "var(--nexus-bg-muted, #f0f0f0)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("click", () => {
        editor.setSelection(entry.from);
        editor.focus();
      });

      list.appendChild(item);
    }
  }

  function update() {
    renderItems(editor.getTableOfContents());
  }

  // Initial render + listen for changes
  update();
  editor.on("change", update);

  return {
    element: panel,
    update,
    destroy() {
      editor.off("change", update);
      panel.remove();
    },
  };
}
