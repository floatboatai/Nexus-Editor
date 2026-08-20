/* eslint-disable max-lines */
import type { EditorAPI } from "@floatboat/nexus-core";

import { applyHighlight, applyTextColor } from "./formatting";
import { toggleHeading } from "./toolbar-commands";

export type OverlayDismissReason = "escape" | "selection" | "tab";

export interface ToolbarOverlay {
  element: HTMLElement;
  focusInitial(): void;
  destroy(): void;
}

interface OverlayOptions {
  id: string;
  onDismiss: (reason: OverlayDismissReason) => void;
}

const DROPDOWN_STYLES = `
  position: fixed;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 4px;
  z-index: 10000;
  min-width: 140px;
`;

const DROPDOWN_ITEM_STYLES = `
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nexus-text, #24292e);
  cursor: pointer;
  text-align: left;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  white-space: nowrap;
  line-height: 1.5;
`;

const COLOR_GRID_STYLES = `
  position: fixed;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 8px;
  z-index: 10000;
  gap: 3px;
`;

const COLOR_PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff", "#ff00ff", "#f4cccc", "#fce5cd",
  "#ea4335", "#ff6d01", "#fbbc04", "#34a853", "#46bdc6", "#4285f4", "#a142f4", "#ff6d9b", "#e06666", "#f6b26b",
  "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#674ea7", "#a64d79", "#990000", "#783f04",
];

const HIGHLIGHT_PALETTE = [
  "#ffff00", "#00ff00", "#00ffff", "#ff9900", "#ff00ff",
  "#fce5cd", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9",
  "#fff2cc", "#b6d7a8", "#a2c4c9", "#9fc5e8", "#b4a7d6",
  "#f4cccc", "#ea9999", "#e6b8af", "#dd7e6b", "#cc4125",
];

export function pickOverlayMount(anchor: HTMLElement): HTMLElement {
  const doc = anchor.ownerDocument;
  const fullscreenElement = doc.fullscreenElement as HTMLElement | null;
  if (fullscreenElement?.contains(anchor)) return fullscreenElement;
  return doc.body;
}

function installOverlayPosition(anchor: HTMLElement, overlay: HTMLElement): () => void {
  const update = () => {
    const rect = anchor.getBoundingClientRect();
    overlay.style.top = `${rect.bottom + 4}px`;
    overlay.style.left = `${rect.left}px`;
  };
  const ownerWindow = anchor.ownerDocument.defaultView;
  update();
  ownerWindow?.addEventListener("scroll", update, true);
  ownerWindow?.addEventListener("resize", update);
  return () => {
    ownerWindow?.removeEventListener("scroll", update, true);
    ownerWindow?.removeEventListener("resize", update);
  };
}

function setItemHighlight(item: HTMLElement, highlighted: boolean): void {
  item.style.background = highlighted ? "var(--nexus-bg-muted, #f0f0f0)" : "transparent";
}

function headingAction(editor: EditorAPI, level: number): void {
  if (level > 0) {
    toggleHeading(editor, level);
    return;
  }

  const doc = editor.getDocument();
  const { anchor: pos } = editor.getSelection();
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const lineEndIndex = doc.indexOf("\n", pos);
  const lineEnd = lineEndIndex === -1 ? doc.length : lineEndIndex;
  const line = doc.slice(lineStart, lineEnd);
  const prefix = line.match(/^#{1,6}\s/)?.[0];
  if (!prefix) return;
  const newLine = line.slice(prefix.length);
  editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(lineEnd));
  editor.setSelection(lineStart + newLine.length);
}

export function createHeadingMenu(
  editor: EditorAPI,
  anchor: HTMLButtonElement,
  options: OverlayOptions,
): ToolbarOverlay {
  const menu = anchor.ownerDocument.createElement("div");
  menu.id = options.id;
  menu.className = "nexus-toolbar-dropdown";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Heading styles");
  menu.style.cssText = DROPDOWN_STYLES;

  const levels = [
    { level: 1, label: "Heading 1", fontSize: "17px", fontWeight: "700" },
    { level: 2, label: "Heading 2", fontSize: "15px", fontWeight: "700" },
    { level: 3, label: "Heading 3", fontSize: "14px", fontWeight: "600" },
    { level: 4, label: "Heading 4", fontSize: "13px", fontWeight: "600" },
    { level: 5, label: "Heading 5", fontSize: "13px", fontWeight: "500" },
    { level: 6, label: "Heading 6", fontSize: "12px", fontWeight: "500" },
    { level: 0, label: "Normal text", fontSize: "13px", fontWeight: "400" },
  ];
  const items = levels.map(({ level, label, fontSize, fontWeight }) => {
    const item = anchor.ownerDocument.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.dataset.headingLevel = String(level);
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.style.cssText = DROPDOWN_ITEM_STYLES;
    item.style.fontSize = fontSize;
    item.style.fontWeight = fontWeight;
    menu.appendChild(item);
    return item;
  });

  const handleClick = (event: MouseEvent) => {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[role="menuitem"]')
      : null;
    if (!item || !menu.contains(item)) return;
    event.preventDefault();
    event.stopPropagation();
    headingAction(editor, Number(item.dataset.headingLevel));
    editor.focus();
    options.onDismiss("selection");
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    const current = event.target as HTMLButtonElement;
    const index = items.indexOf(current);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      current.click();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      options.onDismiss("escape");
      return;
    } else if (event.key === "Tab") {
      options.onDismiss("tab");
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };
  const handleItemEnter = (event: Event) => {
    if (event.target instanceof HTMLElement && items.includes(event.target as HTMLButtonElement)) {
      setItemHighlight(event.target, true);
    }
  };
  const handleItemLeave = (event: Event) => {
    if (event.target instanceof HTMLElement && items.includes(event.target as HTMLButtonElement)) {
      setItemHighlight(event.target, false);
    }
  };

  menu.addEventListener("click", handleClick);
  menu.addEventListener("keydown", handleKeyDown);
  menu.addEventListener("mouseover", handleItemEnter);
  menu.addEventListener("mouseout", handleItemLeave);
  menu.addEventListener("focusin", handleItemEnter);
  menu.addEventListener("focusout", handleItemLeave);
  pickOverlayMount(anchor).appendChild(menu);
  const cleanupPosition = installOverlayPosition(anchor, menu);

  return {
    element: menu,
    focusInitial: () => items[0]?.focus(),
    destroy() {
      cleanupPosition();
      menu.removeEventListener("click", handleClick);
      menu.removeEventListener("keydown", handleKeyDown);
      menu.removeEventListener("mouseover", handleItemEnter);
      menu.removeEventListener("mouseout", handleItemLeave);
      menu.removeEventListener("focusin", handleItemEnter);
      menu.removeEventListener("focusout", handleItemLeave);
      menu.remove();
    },
  };
}

function createColorGrid(
  editor: EditorAPI,
  anchor: HTMLButtonElement,
  palette: string[],
  label: string,
  apply: (editor: EditorAPI, color: string) => boolean,
  options: OverlayOptions,
): ToolbarOverlay {
  const columns = palette.length <= 20 ? 5 : 10;
  const grid = anchor.ownerDocument.createElement("div");
  grid.id = options.id;
  grid.className = "nexus-toolbar-dropdown";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", `${label} palette`);
  grid.style.cssText = `${COLOR_GRID_STYLES}grid-template-columns:repeat(${columns},1fr);`;
  grid.style.display = "grid";

  const items: HTMLButtonElement[] = [];
  for (let rowStart = 0; rowStart < palette.length; rowStart += columns) {
    const row = anchor.ownerDocument.createElement("div");
    row.setAttribute("role", "row");
    row.style.display = "contents";
    for (const color of palette.slice(rowStart, rowStart + columns)) {
      const swatch = anchor.ownerDocument.createElement("button");
      swatch.type = "button";
      swatch.dataset.color = color;
      swatch.title = color;
      swatch.setAttribute("role", "gridcell");
      swatch.setAttribute("aria-label", `${label} ${color}`);
      swatch.tabIndex = -1;
      swatch.style.cssText = `
        width: 22px; height: 22px;
        border: 1px solid var(--nexus-border-subtle, #ddd);
        border-radius: 3px;
        background: ${color};
        cursor: pointer;
        padding: 0;
        transition: transform 0.1s, box-shadow 0.1s;
      `;
      row.appendChild(swatch);
      items.push(swatch);
    }
    grid.appendChild(row);
  }

  const setSwatchHighlight = (swatch: HTMLButtonElement, highlighted: boolean) => {
    swatch.style.transform = highlighted ? "scale(1.2)" : "scale(1)";
    swatch.style.boxShadow = highlighted ? "0 0 0 2px var(--nexus-accent, #0969da)" : "none";
  };
  const handleClick = (event: MouseEvent) => {
    const swatch = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[role="gridcell"]')
      : null;
    if (!swatch || !grid.contains(swatch)) return;
    event.preventDefault();
    event.stopPropagation();
    apply(editor, swatch.dataset.color ?? "");
    editor.focus();
    options.onDismiss("selection");
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    const current = event.target as HTMLButtonElement;
    const index = items.indexOf(current);
    if (index < 0) return;
    const column = index % columns;
    const rowStart = index - column;
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft" && column > 0) nextIndex = index - 1;
    else if (event.key === "ArrowRight" && column < columns - 1 && index + 1 < items.length) nextIndex = index + 1;
    else if (event.key === "ArrowUp" && index >= columns) nextIndex = index - columns;
    else if (event.key === "ArrowDown" && index + columns < items.length) nextIndex = index + columns;
    else if (event.key === "Home") nextIndex = rowStart;
    else if (event.key === "End") nextIndex = Math.min(rowStart + columns - 1, items.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      current.click();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      options.onDismiss("escape");
      return;
    } else if (event.key === "Tab") {
      options.onDismiss("tab");
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };
  const handleEnter = (event: Event) => {
    if (event.target instanceof HTMLButtonElement && items.includes(event.target)) {
      setSwatchHighlight(event.target, true);
    }
  };
  const handleLeave = (event: Event) => {
    if (event.target instanceof HTMLButtonElement && items.includes(event.target)) {
      setSwatchHighlight(event.target, false);
    }
  };

  grid.addEventListener("click", handleClick);
  grid.addEventListener("keydown", handleKeyDown);
  grid.addEventListener("mouseover", handleEnter);
  grid.addEventListener("mouseout", handleLeave);
  grid.addEventListener("focusin", handleEnter);
  grid.addEventListener("focusout", handleLeave);
  pickOverlayMount(anchor).appendChild(grid);
  const cleanupPosition = installOverlayPosition(anchor, grid);

  return {
    element: grid,
    focusInitial: () => items[0]?.focus(),
    destroy() {
      cleanupPosition();
      grid.removeEventListener("click", handleClick);
      grid.removeEventListener("keydown", handleKeyDown);
      grid.removeEventListener("mouseover", handleEnter);
      grid.removeEventListener("mouseout", handleLeave);
      grid.removeEventListener("focusin", handleEnter);
      grid.removeEventListener("focusout", handleLeave);
      grid.remove();
    },
  };
}

export function createTextColorGrid(
  editor: EditorAPI,
  anchor: HTMLButtonElement,
  options: OverlayOptions,
): ToolbarOverlay {
  return createColorGrid(editor, anchor, COLOR_PALETTE, "Text color", applyTextColor, options);
}

export function createHighlightGrid(
  editor: EditorAPI,
  anchor: HTMLButtonElement,
  options: OverlayOptions,
): ToolbarOverlay {
  return createColorGrid(editor, anchor, HIGHLIGHT_PALETTE, "Highlight color", applyHighlight, options);
}
