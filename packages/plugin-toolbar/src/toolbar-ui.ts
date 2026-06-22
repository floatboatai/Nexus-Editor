import type { EditorAPI } from "@floatboat/nexus-core";

import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleWrap,
} from "./index";
import {
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
  insertCodeBlock,
  insertImage,
  applyTextColor,
  applyHighlight,
} from "./formatting";
import {
  iconUndo,
  iconRedo,
  iconLink,
  iconH2,
  iconH3,
  iconHeadingMenu,
  iconBold,
  iconItalic,
  iconStrikethrough,
  iconUnderline,
  iconInlineCode,
  iconBlockquote,
  iconCodeBlock,
  iconOrderedList,
  iconUnorderedList,
  iconTextColor,
  iconHighlight,
  iconImage,
  iconFullscreen,
  iconEmoji,
  iconTable,
} from "./icons";

export interface ToolbarButton {
  id: string;
  title: string;
  icon: () => HTMLElement;
  action: (editor: EditorAPI) => void;
}

export interface ToolbarGroup {
  buttons: ToolbarButton[];
}

export interface ToolbarUIOptions {
  groups?: ToolbarGroup[];
  onFullscreen?: () => void;
}

export interface ToolbarUI {
  element: HTMLElement;
  destroy(): void;
}

let tooltipId = 0;

/**
 * Pick an overlay mount target that stays visible under the HTML Fullscreen API.
 * The Fullscreen API only renders the fullscreen element subtree; anything
 * appended to `document.body` outside that subtree is hidden behind the
 * fullscreen backdrop. So when the toolbar (or its anchor button) lives inside
 * a fullscreen element, mount overlays into that element instead.
 */
function pickOverlayMount(anchor: HTMLElement | Document): HTMLElement {
  const doc = anchor instanceof Document ? anchor : anchor.ownerDocument;
  const node = anchor instanceof Document ? null : anchor;
  const fullscreenEl = doc.fullscreenElement as HTMLElement | null;
  if (fullscreenEl && (!node || fullscreenEl.contains(node))) return fullscreenEl;
  return doc.body;
}

function positionToolbarTooltip(button: HTMLElement, tooltip: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.bottom + 8}px`;
}

function installToolbarTooltip(button: HTMLButtonElement): () => void {
  const tooltip = document.createElement("div");
  tooltip.className = "nexus-toolbar-tooltip";
  tooltip.id = `nexus-toolbar-tooltip-${++tooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  button.setAttribute("aria-describedby", tooltip.id);
  tooltip.style.cssText = `
    position: fixed;
    padding: 4px 10px;
    background: var(--nexus-bg, #ffffff);
    color: var(--nexus-text, #24292e);
    border: 1px solid var(--nexus-border, #e4e7eb);
    border-radius: 4px;
    font-size: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: translateX(-50%);
  `;

  const show = () => {
    const label = button.dataset.toolbarTooltip ?? button.getAttribute("aria-label") ?? "";
    if (!label.trim()) return;
    tooltip.textContent = label;
    tooltip.dataset.state = "open";
    // 禁用垂直滚动，防止 tooltip 导致页面出现滚动条
    document.body.style.overflowY = "hidden";
    if (!tooltip.isConnected) pickOverlayMount(button).appendChild(tooltip);
    positionToolbarTooltip(button, tooltip);
  };
  const hide = () => {
    tooltip.dataset.state = "closed";
    // 恢复垂直滚动
    document.body.style.overflowY = "";
    tooltip.remove();
  };
  const updatePosition = () => {
    if (tooltip.isConnected) positionToolbarTooltip(button, tooltip);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };

  button.addEventListener("mouseenter", show);
  button.addEventListener("focus", show);
  button.addEventListener("mouseleave", hide);
  button.addEventListener("blur", hide);
  button.addEventListener("click", hide);
  button.addEventListener("keydown", handleKeyDown);
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);

  return () => {
    button.removeEventListener("mouseenter", show);
    button.removeEventListener("focus", show);
    button.removeEventListener("mouseleave", hide);
    button.removeEventListener("blur", hide);
    button.removeEventListener("click", hide);
    button.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("scroll", updatePosition, true);
    window.removeEventListener("resize", updatePosition);
    hide();
  };
}

function defaultGroups(options?: ToolbarUIOptions): ToolbarGroup[] {
  return [
    {
      buttons: [
        { id: "undo", title: "Undo", icon: iconUndo, action: (e) => e.undo() },
        { id: "redo", title: "Redo", icon: iconRedo, action: (e) => e.redo() },
      ],
    },
    {
      buttons: [
        { id: "link", title: "Insert link", icon: iconLink, action: insertLink },
      ],
    },
    {
      buttons: [
        { id: "h2", title: "Heading 2", icon: iconH2, action: (e) => toggleHeading(e, 2) },
        { id: "h3", title: "Heading 3", icon: iconH3, action: (e) => toggleHeading(e, 3) },
        { id: "heading-menu", title: "More headings", icon: iconHeadingMenu, action: () => {} },
      ],
    },
    {
      buttons: [
        { id: "bold", title: "Bold", icon: iconBold, action: toggleBold },
        { id: "italic", title: "Italic", icon: iconItalic, action: toggleItalic },
        { id: "strikethrough", title: "Strikethrough", icon: iconStrikethrough, action: toggleStrikethrough },
        { id: "underline", title: "Underline", icon: iconUnderline, action: (e) => toggleWrap(e, "<u>") },
        { id: "inline-code", title: "Inline code", icon: iconInlineCode, action: toggleInlineCode },
      ],
    },
    {
      buttons: [
        { id: "blockquote", title: "Blockquote", icon: iconBlockquote, action: toggleBlockquote },
        { id: "code-block", title: "Code block", icon: iconCodeBlock, action: insertCodeBlock },
      ],
    },
    {
      buttons: [
        { id: "ordered-list", title: "Ordered list", icon: iconOrderedList, action: toggleOrderedList },
        { id: "unordered-list", title: "Unordered list", icon: iconUnorderedList, action: toggleUnorderedList },
      ],
    },
    {
      buttons: [
        { id: "text-color", title: "Text color", icon: iconTextColor, action: () => {} },
        { id: "highlight", title: "Highlight", icon: iconHighlight, action: () => {} },
      ],
    },
    {
      buttons: [
        { id: "table", title: "Insert table", icon: iconTable, action: () => {} },
        { id: "emoji", title: "Insert emoji", icon: iconEmoji, action: () => {} },
      ],
    },
    {
      buttons: [
        { id: "image", title: "Insert image", icon: iconImage, action: insertImage },
        { id: "fullscreen", title: "Fullscreen", icon: iconFullscreen, action: () => options?.onFullscreen?.() },
      ],
    },
  ];
}

const TOOLBAR_STYLES = `
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  background: var(--nexus-bg-subtle, #f6f8fa);
  border-bottom: 1px solid var(--nexus-border, #eee);
  user-select: none;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  font-family: system-ui, -apple-system, sans-serif;
`;

const BUTTON_STYLES = `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nexus-text-muted, #888);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
`;

const SEPARATOR_STYLES = `
  width: 1px;
  height: 18px;
  background: var(--nexus-border-subtle, #ddd);
  margin: 0 4px;
  flex-shrink: 0;
`;

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

/** Mount a heading dropdown onto document.body, positioned below the anchor button. */
function showHeadingDropdown(
  editor: EditorAPI,
  anchorBtn: HTMLElement,
  onClose: () => void,
): { destroy: () => void } {
  const menu = document.createElement("div");
  menu.className = "nexus-toolbar-dropdown";
  menu.style.cssText = DROPDOWN_STYLES;

  // Position below the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + "px";
  menu.style.left = rect.left + "px";

  const levels = [
    { level: 1, label: "Heading 1", fontSize: "17px", fontWeight: "700" },
    { level: 2, label: "Heading 2", fontSize: "15px", fontWeight: "700" },
    { level: 3, label: "Heading 3", fontSize: "14px", fontWeight: "600" },
    { level: 4, label: "Heading 4", fontSize: "13px", fontWeight: "600" },
    { level: 5, label: "Heading 5", fontSize: "13px", fontWeight: "500" },
    { level: 6, label: "Heading 6", fontSize: "12px", fontWeight: "500" },
    { level: 0, label: "Normal text", fontSize: "13px", fontWeight: "400" },
  ];

  const itemCleanups: Array<() => void> = [];

  for (const { level, label, fontSize, fontWeight } of levels) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.style.cssText = DROPDOWN_ITEM_STYLES;
    item.style.fontSize = fontSize;
    item.style.fontWeight = fontWeight;

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (level > 0) {
        toggleHeading(editor, level);
      } else {
        // Remove any heading prefix on the current line
        const doc = editor.getDocument();
        const { anchor: pos } = editor.getSelection();
        const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
        const lineEndIdx = doc.indexOf("\n", pos);
        const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
        const line = doc.slice(lineStart, lineEnd);
        const m = line.match(/^#{1,6}\s/);
        if (m) {
          const newLine = line.slice(m[0].length);
          editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(lineEnd));
          editor.setSelection(lineStart + newLine.length);
        }
      }
      editor.focus();
      onClose();
    };

    const handleEnter = () => { item.style.background = "var(--nexus-bg-muted, #f0f0f0)"; };
    const handleLeave = () => { item.style.background = "transparent"; };

    item.addEventListener("click", handleClick);
    item.addEventListener("mouseenter", handleEnter);
    item.addEventListener("mouseleave", handleLeave);
    itemCleanups.push(() => {
      item.removeEventListener("click", handleClick);
      item.removeEventListener("mouseenter", handleEnter);
      item.removeEventListener("mouseleave", handleLeave);
    });

    menu.appendChild(item);
  }

  pickOverlayMount(anchorBtn).appendChild(menu);

  return {
    destroy() {
      for (const fn of itemCleanups) fn();
      itemCleanups.length = 0;
      menu.remove();
    },
  };
}

const COLOR_PALETTE = [
  // row 1: grays + black/white
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  // row 2: saturated
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff", "#ff00ff", "#f4cccc", "#fce5cd",
  // row 3: muted
  "#ea4335", "#ff6d01", "#fbbc04", "#34a853", "#46bdc6", "#4285f4", "#a142f4", "#ff6d9b", "#e06666", "#f6b26b",
  // row 4: dark
  "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#674ea7", "#a64d79", "#990000", "#783f04",
];

const HIGHLIGHT_PALETTE = [
  "#ffff00", "#00ff00", "#00ffff", "#ff9900", "#ff00ff",
  "#fce5cd", "#d9ead3", "#d0e0e3", "#cfe2f3", "#d9d2e9",
  "#fff2cc", "#b6d7a8", "#a2c4c9", "#9fc5e8", "#b4a7d6",
  "#f4cccc", "#ea9999", "#e6b8af", "#dd7e6b", "#cc4125",
];

const COLOR_GRID_STYLES = `
  position: fixed;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 8px;
  z-index: 10000;
`;

function showColorPicker(
  editor: EditorAPI,
  anchorBtn: HTMLElement,
  palette: string[],
  apply: (editor: EditorAPI, color: string) => boolean,
  onClose: () => void,
): { destroy: () => void } {
  const panel = document.createElement("div");
  panel.className = "nexus-toolbar-dropdown";
  panel.style.cssText = COLOR_GRID_STYLES;

  const rect = anchorBtn.getBoundingClientRect();
  panel.style.top = rect.bottom + 4 + "px";
  panel.style.left = rect.left + "px";

  const cols = palette.length <= 20 ? 5 : 10;
  const grid = document.createElement("div");
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:3px;`;

  const itemCleanups: Array<() => void> = [];

  for (const color of palette) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.title = color;
    swatch.style.cssText = `
      width: 22px; height: 22px;
      border: 1px solid var(--nexus-border-subtle, #ddd);
      border-radius: 3px;
      background: ${color};
      cursor: pointer;
      padding: 0;
      transition: transform 0.1s, box-shadow 0.1s;
    `;

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      apply(editor, color);
      editor.focus();
      onClose();
    };
    const handleEnter = () => {
      swatch.style.transform = "scale(1.2)";
      swatch.style.boxShadow = "0 0 0 2px var(--nexus-accent, #0969da)";
    };
    const handleLeave = () => {
      swatch.style.transform = "scale(1)";
      swatch.style.boxShadow = "none";
    };

    swatch.addEventListener("click", handleClick);
    swatch.addEventListener("mouseenter", handleEnter);
    swatch.addEventListener("mouseleave", handleLeave);
    itemCleanups.push(() => {
      swatch.removeEventListener("click", handleClick);
      swatch.removeEventListener("mouseenter", handleEnter);
      swatch.removeEventListener("mouseleave", handleLeave);
    });

    grid.appendChild(swatch);
  }

  panel.appendChild(grid);
  pickOverlayMount(anchorBtn).appendChild(panel);

  return {
    destroy() {
      for (const fn of itemCleanups) fn();
      itemCleanups.length = 0;
      panel.remove();
    },
  };
}

const EMOJI_PALETTE = [
  // Smileys & People
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
  "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩",
  // Animals & Nature
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
  "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
  // Food & Drink
  "🍎", "🍊", "🍋", "🍇", "🍓", "🍑", "🍒", "🥝",
  "🍅", "🥑", "🍕", "🍔", "🍟", "🌭", "🍿", "🍦",
  // Activities
  "⚽", "🏀", "🎾", "🏈", "⚾", "🎱", "🏆", "🎮",
  "🎲", "🎸", "🎹", "🎤", "🎧", "🎨", "📷", "🎭",
];

const EMOJI_PICKER_STYLES = `
  position: fixed;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 8px;
  z-index: 10000;
  max-height: 300px;
  overflow-y: auto;
`;

const TABLE_PICKER_STYLES = `
  position: fixed;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 12px;
  z-index: 10000;
`;

function showTablePicker(
  editor: EditorAPI,
  anchorBtn: HTMLElement,
  onClose: () => void,
): { destroy: () => void } {
  const panel = document.createElement("div");
  panel.className = "nexus-toolbar-dropdown";
  panel.style.cssText = TABLE_PICKER_STYLES;

  const rect = anchorBtn.getBoundingClientRect();
  panel.style.top = rect.bottom + 4 + "px";
  panel.style.left = rect.left + "px";

  const label = document.createElement("div");
  label.style.cssText = `
    font-size: 12px;
    color: var(--nexus-text-muted, #888);
    margin-bottom: 8px;
    padding: 0 4px;
  `;
  label.textContent = "Select rows × columns";
  panel.appendChild(label);

  const grid = document.createElement("div");
  grid.style.cssText = `display:grid;grid-template-columns:repeat(6,1fr);gap:2px;`;

  const maxRows = 6;
  const maxCols = 6;
  const itemCleanups: Array<() => void> = [];

  for (let rows = 1; rows <= maxRows; rows++) {
    for (let cols = 1; cols <= maxCols; cols++) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${rows}×${cols}`;
      button.dataset.rows = String(rows);
      button.dataset.cols = String(cols);
      button.style.cssText = `
        padding: 6px 10px;
        border: 1px solid var(--nexus-border-subtle, #ddd);
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        font-family: system-ui, -apple-system, sans-serif;
        color: var(--nexus-text, #24292e);
        transition: background 0.15s, border-color 0.15s;
      `;

      const handleClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const r = parseInt(button.dataset.rows || "3");
        const c = parseInt(button.dataset.cols || "3");
        
        const headerRow = "| " + Array(c).fill("Header").join(" | ") + " |";
        const separatorRow = "| " + Array(c).fill("---").join(" | ") + " |";
        const bodyRows = Array(r - 1).fill("| " + Array(c).fill("").join(" | ") + " |").join("\n");
        
        const table = headerRow + "\n" + separatorRow + "\n" + bodyRows;
        
        const doc = editor.getDocument();
        const { anchor, head } = editor.getSelection();
        const before = doc.slice(0, anchor);
        const after = doc.slice(head);
        editor.setDocument(before + table + after);
        editor.setSelection(anchor + table.length);
        editor.focus();
        onClose();
      };
      const handleEnter = () => { 
        button.style.background = "var(--nexus-bg-muted, #f0f0f0)"; 
        button.style.borderColor = "var(--nexus-accent, #0969da)";
      };
      const handleLeave = () => { 
        button.style.background = "transparent"; 
        button.style.borderColor = "var(--nexus-border-subtle, #ddd)";
      };

      button.addEventListener("click", handleClick);
      button.addEventListener("mouseenter", handleEnter);
      button.addEventListener("mouseleave", handleLeave);
      itemCleanups.push(() => {
        button.removeEventListener("click", handleClick);
        button.removeEventListener("mouseenter", handleEnter);
        button.removeEventListener("mouseleave", handleLeave);
      });

      grid.appendChild(button);
    }
  }

  panel.appendChild(grid);
  pickOverlayMount(anchorBtn).appendChild(panel);

  return {
    destroy() {
      for (const fn of itemCleanups) fn();
      itemCleanups.length = 0;
      panel.remove();
    },
  };
}

function showEmojiPicker(
  editor: EditorAPI,
  anchorBtn: HTMLElement,
  onClose: () => void,
): { destroy: () => void } {
  const panel = document.createElement("div");
  panel.className = "nexus-toolbar-dropdown";
  panel.style.cssText = EMOJI_PICKER_STYLES;

  const rect = anchorBtn.getBoundingClientRect();
  panel.style.top = rect.bottom + 4 + "px";
  panel.style.left = rect.left + "px";

  const grid = document.createElement("div");
  grid.style.cssText = `display:grid;grid-template-columns:repeat(8,1fr);gap:2px;`;

  const itemCleanups: Array<() => void> = [];

  for (const emoji of EMOJI_PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.style.cssText = `
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      padding: 0;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    `;

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const doc = editor.getDocument();
      const { anchor, head } = editor.getSelection();
      const before = doc.slice(0, anchor);
      const after = doc.slice(head);
      editor.setDocument(before + emoji + after);
      editor.setSelection(anchor + emoji.length);
      editor.focus();
      onClose();
    };
    const handleEnter = () => { button.style.background = "var(--nexus-bg-muted, #f0f0f0)"; };
    const handleLeave = () => { button.style.background = "transparent"; };

    button.addEventListener("click", handleClick);
    button.addEventListener("mouseenter", handleEnter);
    button.addEventListener("mouseleave", handleLeave);
    itemCleanups.push(() => {
      button.removeEventListener("click", handleClick);
      button.removeEventListener("mouseenter", handleEnter);
      button.removeEventListener("mouseleave", handleLeave);
    });

    grid.appendChild(button);
  }

  panel.appendChild(grid);
  pickOverlayMount(anchorBtn).appendChild(panel);

  return {
    destroy() {
      for (const fn of itemCleanups) fn();
      itemCleanups.length = 0;
      panel.remove();
    },
  };
}

/** IDs that trigger dropdown behavior instead of a direct action. */
const DROPDOWN_IDS = new Set(["heading-menu", "text-color", "highlight", "emoji", "table"]);

export function createToolbarUI(editor: EditorAPI, options?: ToolbarUIOptions): ToolbarUI {
  const groups = options?.groups ?? defaultGroups(options);
  const toolbar = document.createElement("div");
  toolbar.className = "nexus-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.style.cssText = TOOLBAR_STYLES;

  const cleanupFns: Array<() => void> = [];
  let activeDropdown: { destroy: () => void } | null = null;
  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.destroy();
      activeDropdown = null;
    }
    if (outsideHandler) {
      document.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
  }

  function applyHover(btn: HTMLElement) {
    btn.style.background = "var(--nexus-bg-muted, #f0f0f0)";
    btn.style.color = "var(--nexus-text, #24292e)";
  }
  function clearHover(btn: HTMLElement) {
    btn.style.background = "transparent";
    btn.style.color = "var(--nexus-text-muted, #888)";
  }

  groups.forEach((group, groupIdx) => {
    if (groupIdx > 0) {
      const sep = document.createElement("div");
      sep.className = "nexus-toolbar-separator";
      sep.style.cssText = SEPARATOR_STYLES;
      toolbar.appendChild(sep);
    }

    for (const btn of group.buttons) {
      const button = document.createElement("button");
      button.className = "nexus-toolbar-btn";
      button.dataset.toolbarAction = btn.id;
      button.dataset.toolbarTooltip = btn.title;
      button.setAttribute("aria-label", btn.title);
      button.type = "button";
      button.tabIndex = -1;
      button.style.cssText = BUTTON_STYLES;
      button.appendChild(btn.icon());
      const cleanupTooltip = installToolbarTooltip(button);

      const handleMouseEnter = () => applyHover(button);
      const handleMouseLeave = () => clearHover(button);

      if (DROPDOWN_IDS.has(btn.id)) {
        const handleClick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();

          if (activeDropdown) { closeDropdown(); return; }

          if (btn.id === "heading-menu") {
            activeDropdown = showHeadingDropdown(editor, button, closeDropdown);
          } else if (btn.id === "text-color") {
            activeDropdown = showColorPicker(editor, button, COLOR_PALETTE, applyTextColor, closeDropdown);
          } else if (btn.id === "highlight") {
            activeDropdown = showColorPicker(editor, button, HIGHLIGHT_PALETTE, applyHighlight, closeDropdown);
          } else if (btn.id === "emoji") {
            activeDropdown = showEmojiPicker(editor, button, closeDropdown);
          } else if (btn.id === "table") {
            activeDropdown = showTablePicker(editor, button, closeDropdown);
          }

          outsideHandler = (ev: MouseEvent) => {
            const dropdownEl = document.querySelector(".nexus-toolbar-dropdown");
            if (!button.contains(ev.target as Node) && (!dropdownEl || !dropdownEl.contains(ev.target as Node))) {
              closeDropdown();
            }
          };
          requestAnimationFrame(() => {
            if (outsideHandler) document.addEventListener("mousedown", outsideHandler, true);
          });
        };

        button.addEventListener("click", handleClick);
        button.addEventListener("mouseenter", handleMouseEnter);
        button.addEventListener("mouseleave", handleMouseLeave);
        cleanupFns.push(() => {
          button.removeEventListener("click", handleClick);
          button.removeEventListener("mouseenter", handleMouseEnter);
          button.removeEventListener("mouseleave", handleMouseLeave);
          cleanupTooltip();
          closeDropdown();
        });
        toolbar.appendChild(button);
        continue;
      }

      const handleClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        btn.action(editor);
        editor.focus();
      };

      button.addEventListener("click", handleClick);
      button.addEventListener("mouseenter", handleMouseEnter);
      button.addEventListener("mouseleave", handleMouseLeave);

      cleanupFns.push(() => {
        button.removeEventListener("click", handleClick);
        button.removeEventListener("mouseenter", handleMouseEnter);
        button.removeEventListener("mouseleave", handleMouseLeave);
        cleanupTooltip();
      });

      toolbar.appendChild(button);
    }
  });

  return {
    element: toolbar,
    destroy() {
      closeDropdown();
      for (const fn of cleanupFns) fn();
      cleanupFns.length = 0;
      toolbar.remove();
    },
  };
}
