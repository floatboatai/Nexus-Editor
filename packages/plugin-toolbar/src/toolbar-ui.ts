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
} from "./icons";

export interface ToolbarButton {
  id: string;
  title: string;
  /** Optional keyboard shortcut shown in the hover tooltip (e.g. "⌘B"). */
  shortcut?: string;
  icon: () => HTMLElement;
  action: (editor: EditorAPI) => boolean | void | Promise<boolean | void>;
}

export interface ToolbarGroup {
  buttons: ToolbarButton[];
}

export interface ToolbarUIOptions {
  groups?: ToolbarGroup[];
  onFullscreen?: () => void;
  /** Override the default image insert action (e.g. open a file picker). */
  onInsertImage?: (editor: EditorAPI) => void | Promise<void>;
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

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/** Normalize shortcut labels for the current OS (⌘ vs Ctrl). */
export function formatShortcut(shortcut: string): string {
  if (isMacPlatform()) return shortcut;
  return shortcut
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+")
    .replace(/⌃/g, "Ctrl+");
}

function positionToolbarTooltip(button: HTMLElement, tooltip: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  // Measure after content is in the DOM; center under the button without
  // relying on CSS transform (which was offsetting relative to the icon).
  tooltip.style.visibility = "hidden";
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  tooltip.style.transform = "none";
  const tip = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tip.width / 2;
  let top = rect.bottom + 6;
  left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
  if (top + tip.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - tip.height - 6);
  }
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.visibility = "visible";
}

function installToolbarTooltip(button: HTMLButtonElement): () => void {
  const tooltip = document.createElement("div");
  tooltip.className = "nexus-toolbar-tooltip";
  tooltip.id = `nexus-toolbar-tooltip-${++tooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  button.setAttribute("aria-describedby", tooltip.id);

  const show = () => {
    const label = button.dataset.toolbarTooltip ?? button.getAttribute("aria-label") ?? "";
    const shortcut = button.dataset.toolbarShortcut ?? "";
    if (!label.trim()) return;
    tooltip.textContent = "";
    const titleSpan = document.createElement("span");
    titleSpan.className = "nexus-toolbar-tooltip__title";
    titleSpan.textContent = label;
    tooltip.appendChild(titleSpan);
    if (shortcut) {
      const kbd = document.createElement("kbd");
      kbd.className = "nexus-toolbar-tooltip__shortcut";
      kbd.textContent = formatShortcut(shortcut);
      tooltip.appendChild(kbd);
    }
    tooltip.dataset.state = "open";
    if (!tooltip.isConnected) pickOverlayMount(button).appendChild(tooltip);
    // Double-rAF: first paints content, second measures for accurate centering.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => positionToolbarTooltip(button, tooltip));
    });
  };
  const hide = () => {
    tooltip.dataset.state = "closed";
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
  const imageAction = options?.onInsertImage
    ? (e: EditorAPI) => { void options.onInsertImage?.(e); }
    : insertImage;

  return [
    {
      buttons: [
        { id: "undo", title: "Undo", shortcut: "⌘Z", icon: iconUndo, action: (e) => e.undo() },
        { id: "redo", title: "Redo", shortcut: "⌘⇧Z", icon: iconRedo, action: (e) => e.redo() },
      ],
    },
    {
      buttons: [
        { id: "link", title: "Insert link", shortcut: "⌘K", icon: iconLink, action: insertLink },
      ],
    },
    {
      buttons: [
        { id: "h2", title: "Heading 2", shortcut: "⌘2", icon: iconH2, action: (e) => toggleHeading(e, 2) },
        { id: "h3", title: "Heading 3", shortcut: "⌘3", icon: iconH3, action: (e) => toggleHeading(e, 3) },
        { id: "heading-menu", title: "More headings", icon: iconHeadingMenu, action: () => {} },
      ],
    },
    {
      buttons: [
        { id: "bold", title: "Bold", shortcut: "⌘B", icon: iconBold, action: toggleBold },
        { id: "italic", title: "Italic", shortcut: "⌘I", icon: iconItalic, action: toggleItalic },
        { id: "strikethrough", title: "Strikethrough", shortcut: "⌘⇧S", icon: iconStrikethrough, action: toggleStrikethrough },
        { id: "underline", title: "Underline", icon: iconUnderline, action: (e) => toggleWrap(e, "<u>") },
        { id: "inline-code", title: "Inline code", shortcut: "⌘E", icon: iconInlineCode, action: toggleInlineCode },
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
        { id: "image", title: "Insert image", icon: iconImage, action: imageAction },
        { id: "fullscreen", title: "Fullscreen", icon: iconFullscreen, action: () => options?.onFullscreen?.() },
      ],
    },
  ];
}

const TOOLBAR_STYLES = `
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 10px;
  background: var(--nexus-bg-subtle, #f6f8fa);
  border-bottom: 1px solid var(--nexus-border, #eee);
  user-select: none;
  flex-shrink: 0;
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  width: 100%;
  height: 40px;
  box-sizing: border-box;
`;

const BUTTON_STYLES = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  max-width: 28px;
  max-height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--nexus-text-muted, #888);
  cursor: pointer;
  padding: 0;
  margin: 0;
  flex: 0 0 28px;
  box-sizing: border-box;
  line-height: 0;
  vertical-align: middle;
  transition: background-color 0.12s ease, color 0.12s ease;
`;

const SEPARATOR_STYLES = `
  width: 1px;
  height: 16px;
  background: var(--nexus-border-subtle, #ddd);
  margin: 0 4px;
  flex: 0 0 1px;
  align-self: center;
  box-sizing: border-box;
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

/** IDs that trigger dropdown behavior instead of a direct action. */
const DROPDOWN_IDS = new Set(["heading-menu", "text-color", "highlight"]);

const OVERFLOW_BTN_STYLES = `
  display: none;
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
  margin-left: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
`;

export function createToolbarUI(editor: EditorAPI, options?: ToolbarUIOptions): ToolbarUI {
  const groups = options?.groups ?? defaultGroups(options);
  const toolbar = document.createElement("div");
  toolbar.className = "nexus-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.style.cssText = TOOLBAR_STYLES;

  const cleanupFns: Array<() => void> = [];
  let activeDropdown: { destroy: () => void } | null = null;
  let outsideHandler: ((e: MouseEvent) => void) | null = null;

  /** Flat list of primary toolbar items (buttons + group seps) for overflow. */
  const primaryItems: HTMLElement[] = [];
  /** Button defs in visual order for the overflow menu. */
  const buttonDefs: ToolbarButton[] = [];
  const buttonEls: HTMLButtonElement[] = [];

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

  // Hover is CSS-only (.nexus-toolbar-btn:hover) so we never mutate inline
  // styles on mouseenter — that was reflowing the overflow layout mid-hover.

  function wireButton(btn: ToolbarButton, button: HTMLButtonElement): void {
    button.className = "nexus-toolbar-btn";
    button.dataset.toolbarAction = btn.id;
    button.dataset.toolbarTooltip = btn.title;
    if (btn.shortcut) button.dataset.toolbarShortcut = btn.shortcut;
    button.setAttribute(
      "aria-label",
      btn.shortcut ? `${btn.title} (${formatShortcut(btn.shortcut)})` : btn.title
    );
    button.type = "button";
    button.tabIndex = -1;
    button.style.cssText = BUTTON_STYLES;
    button.appendChild(btn.icon());
    const cleanupTooltip = installToolbarTooltip(button);

    if (DROPDOWN_IDS.has(btn.id)) {
      const handleClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeDropdown) {
          closeDropdown();
          return;
        }
        if (btn.id === "heading-menu") {
          activeDropdown = showHeadingDropdown(editor, button, closeDropdown);
        } else if (btn.id === "text-color") {
          activeDropdown = showColorPicker(editor, button, COLOR_PALETTE, applyTextColor, closeDropdown);
        } else if (btn.id === "highlight") {
          activeDropdown = showColorPicker(editor, button, HIGHLIGHT_PALETTE, applyHighlight, closeDropdown);
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
      cleanupFns.push(() => {
        button.removeEventListener("click", handleClick);
        cleanupTooltip();
      });
      return;
    }

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      closeDropdown();
      void Promise.resolve(btn.action(editor)).then(() => editor.focus());
    };
    button.addEventListener("click", handleClick);
    cleanupFns.push(() => {
      button.removeEventListener("click", handleClick);
      cleanupTooltip();
    });
  }

  groups.forEach((group, groupIdx) => {
    if (groupIdx > 0) {
      const sep = document.createElement("div");
      sep.className = "nexus-toolbar-separator";
      sep.style.cssText = SEPARATOR_STYLES;
      toolbar.appendChild(sep);
      primaryItems.push(sep);
    }
    for (const btn of group.buttons) {
      const button = document.createElement("button");
      wireButton(btn, button);
      toolbar.appendChild(button);
      primaryItems.push(button);
      buttonDefs.push(btn);
      buttonEls.push(button);
    }
  });

  // Overflow cluster pinned to the right:  |  ···
  const overflowSlot = document.createElement("div");
  overflowSlot.className = "nexus-toolbar-overflow-slot";
  overflowSlot.style.cssText =
    "display:none;align-items:center;flex-shrink:0;margin-left:auto;padding-left:2px;";

  const overflowSep = document.createElement("div");
  overflowSep.className = "nexus-toolbar-separator nexus-toolbar-overflow-sep";
  overflowSep.style.cssText = SEPARATOR_STYLES;
  overflowSep.style.display = "";
  overflowSep.style.margin = "0 6px 0 2px";

  const overflowBtn = document.createElement("button");
  overflowBtn.type = "button";
  overflowBtn.className = "nexus-toolbar-btn nexus-toolbar-overflow-btn";
  overflowBtn.style.cssText = OVERFLOW_BTN_STYLES;
  overflowBtn.style.display = "flex";
  overflowBtn.dataset.toolbarTooltip = "More actions";
  overflowBtn.setAttribute("aria-label", "More actions");
  overflowBtn.setAttribute("aria-haspopup", "menu");
  // ASCII ellipsis — more reliable than U+22EF across fonts.
  overflowBtn.textContent = "...";
  const cleanupOverflowTip = installToolbarTooltip(overflowBtn);
  cleanupFns.push(cleanupOverflowTip);

  overflowSlot.append(overflowSep, overflowBtn);
  toolbar.appendChild(overflowSlot);

  function showOverflowMenu(): void {
    closeDropdown();
    const menu = document.createElement("div");
    menu.className = "nexus-toolbar-dropdown nexus-toolbar-overflow-menu";
    menu.style.cssText = DROPDOWN_STYLES;
    menu.setAttribute("role", "menu");

    const rect = overflowBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = "auto";
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.minWidth = "180px";

    for (let i = 0; i < buttonEls.length; i++) {
      const el = buttonEls[i];
      if (el.style.display === "none") {
        const def = buttonDefs[i];
        const item = document.createElement("button");
        item.type = "button";
        item.className = "nexus-toolbar-overflow-item";
        item.style.cssText = DROPDOWN_ITEM_STYLES;
        item.setAttribute("role", "menuitem");
        const label = document.createElement("span");
        label.textContent = def.title;
        item.appendChild(label);
        if (def.shortcut) {
          const kbd = document.createElement("kbd");
          kbd.style.cssText = "margin-left:auto;padding-left:16px;font-size:11px;color:var(--nexus-text-muted,#888);";
          kbd.textContent = formatShortcut(def.shortcut);
          item.appendChild(kbd);
        }
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.addEventListener("mouseenter", () => {
          item.style.background = "var(--nexus-bg-muted, #f0f0f0)";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "transparent";
        });
        item.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeDropdown();
          if (DROPDOWN_IDS.has(def.id)) {
            // Re-open the original control's dropdown from the overflow trigger.
            if (def.id === "heading-menu") {
              activeDropdown = showHeadingDropdown(editor, overflowBtn, closeDropdown);
            } else if (def.id === "text-color") {
              activeDropdown = showColorPicker(editor, overflowBtn, COLOR_PALETTE, applyTextColor, closeDropdown);
            } else if (def.id === "highlight") {
              activeDropdown = showColorPicker(editor, overflowBtn, HIGHLIGHT_PALETTE, applyHighlight, closeDropdown);
            }
            return;
          }
          void Promise.resolve(def.action(editor)).then(() => editor.focus());
        });
        menu.appendChild(item);
      }
    }

    pickOverlayMount(overflowBtn).appendChild(menu);
    activeDropdown = {
      destroy() {
        menu.remove();
      },
    };
    outsideHandler = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && !overflowBtn.contains(ev.target as Node)) {
        closeDropdown();
      }
    };
    requestAnimationFrame(() => {
      if (outsideHandler) document.addEventListener("mousedown", outsideHandler, true);
    });
  }

  overflowBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeDropdown) {
      closeDropdown();
      return;
    }
    showOverflowMenu();
  });

  /** Last applied hide index — skip DOM writes when nothing changed (avoids hover reflow). */
  let lastHideFrom = -1;
  let lastOverflowVisible = false;

  function layoutOverflow(): void {
    const available = toolbar.clientWidth;
    if (available <= 0) return;

    // Measure with everything shown (temporarily) without thrashing if already open.
    for (const item of primaryItems) {
      if (item.style.display === "none") item.style.display = "";
    }
    // Measure full width with overflow hidden so we know if we need it.
    overflowSlot.style.display = "none";

    let used = 0;
    for (const item of primaryItems) {
      used += item.getBoundingClientRect().width + 2;
    }

    let hideFrom = primaryItems.length;
    let overflowVisible = false;

    if (used > available - 4) {
      overflowSlot.style.display = "flex";
      const reserve = overflowSlot.getBoundingClientRect().width + 8;
      used = 0;
      hideFrom = primaryItems.length;
      for (let i = 0; i < primaryItems.length; i++) {
        const w = primaryItems[i].getBoundingClientRect().width + 2;
        if (used + w > available - reserve) {
          hideFrom = i;
          break;
        }
        used += w;
      }
      while (
        hideFrom > 0 &&
        primaryItems[hideFrom - 1].classList.contains("nexus-toolbar-separator")
      ) {
        hideFrom--;
      }
      overflowVisible = hideFrom < primaryItems.length;
      if (!overflowVisible) {
        overflowSlot.style.display = "none";
        hideFrom = primaryItems.length;
      }
    }

    if (hideFrom === lastHideFrom && overflowVisible === lastOverflowVisible) {
      // Re-apply hide states only if we temporarily un-hid for measure.
      for (let i = 0; i < primaryItems.length; i++) {
        primaryItems[i].style.display = i >= hideFrom ? "none" : "";
      }
      overflowSlot.style.display = overflowVisible ? "flex" : "none";
      return;
    }

    lastHideFrom = hideFrom;
    lastOverflowVisible = overflowVisible;

    for (let i = 0; i < primaryItems.length; i++) {
      primaryItems[i].style.display = i >= hideFrom ? "none" : "";
    }
    overflowSlot.style.display = overflowVisible ? "flex" : "none";
  }

  let ro: ResizeObserver | null = null;
  let layoutRaf = 0;
  const scheduleLayout = () => {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      layoutOverflow();
    });
  };
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => scheduleLayout());
    ro.observe(toolbar);
  }
  window.addEventListener("resize", scheduleLayout);
  // Layout after mount / fonts
  requestAnimationFrame(() => requestAnimationFrame(layoutOverflow));

  cleanupFns.push(() => {
    ro?.disconnect();
    window.removeEventListener("resize", scheduleLayout);
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    closeDropdown();
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
