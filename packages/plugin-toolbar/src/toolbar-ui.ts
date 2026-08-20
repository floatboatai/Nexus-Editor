/* eslint-disable max-lines */
import type { EditorAPI } from "@floatboat/nexus-core";

import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  toggleHeading,
  toggleWrap,
} from "./toolbar-commands";
import {
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
  insertCodeBlock,
  insertImage,
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
import { installToolbarNavigation } from "./toolbar-navigation";
import {
  createHeadingMenu,
  createHighlightGrid,
  createTextColorGrid,
  pickOverlayMount,
  type OverlayDismissReason,
  type ToolbarOverlay,
} from "./toolbar-overlays";

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
let overlayId = 0;

function positionToolbarTooltip(button: HTMLElement, tooltip: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.bottom + 8}px`;
}

function installToolbarTooltip(button: HTMLButtonElement): () => void {
  const tooltip = button.ownerDocument.createElement("div");
  const ownerWindow = button.ownerDocument.defaultView;
  tooltip.className = "nexus-toolbar-tooltip";
  tooltip.id = `nexus-toolbar-tooltip-${++tooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  button.setAttribute("aria-describedby", tooltip.id);

  const show = () => {
    const label = button.dataset.toolbarTooltip ?? button.getAttribute("aria-label") ?? "";
    if (!label.trim()) return;
    tooltip.textContent = label;
    tooltip.dataset.state = "open";
    if (!tooltip.isConnected) pickOverlayMount(button).appendChild(tooltip);
    positionToolbarTooltip(button, tooltip);
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
  ownerWindow?.addEventListener("scroll", updatePosition, true);
  ownerWindow?.addEventListener("resize", updatePosition);

  return () => {
    button.removeEventListener("mouseenter", show);
    button.removeEventListener("focus", show);
    button.removeEventListener("mouseleave", hide);
    button.removeEventListener("blur", hide);
    button.removeEventListener("click", hide);
    button.removeEventListener("keydown", handleKeyDown);
    ownerWindow?.removeEventListener("scroll", updatePosition, true);
    ownerWindow?.removeEventListener("resize", updatePosition);
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
    { buttons: [{ id: "link", title: "Insert link", icon: iconLink, action: insertLink }] },
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

const DROPDOWN_IDS = new Set(["heading-menu", "text-color", "highlight"]);

interface ActiveDropdown {
  trigger: HTMLButtonElement;
  overlay: ToolbarOverlay;
}

function applyHover(button: HTMLElement): void {
  button.style.background = "var(--nexus-bg-muted, #f0f0f0)";
  button.style.color = "var(--nexus-text, #24292e)";
}

function clearHover(button: HTMLElement): void {
  button.style.background = "transparent";
  button.style.color = "var(--nexus-text-muted, #888)";
}

export function createToolbarUI(editor: EditorAPI, options?: ToolbarUIOptions): ToolbarUI {
  const groups = options?.groups ?? defaultGroups(options);
  const toolbar = document.createElement("div");
  toolbar.className = "nexus-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Formatting toolbar");
  toolbar.setAttribute("aria-orientation", "horizontal");
  toolbar.style.cssText = TOOLBAR_STYLES;

  const cleanupFns: Array<() => void> = [];
  const toolbarButtons: HTMLButtonElement[] = [];
  let activeDropdown: ActiveDropdown | null = null;
  let outsideHandler: ((event: MouseEvent) => void) | null = null;

  const closeDropdown = (restoreTriggerFocus = false) => {
    const current = activeDropdown;
    activeDropdown = null;
    if (outsideHandler) {
      toolbar.ownerDocument.removeEventListener("mousedown", outsideHandler, true);
      outsideHandler = null;
    }
    if (!current) return;
    current.overlay.destroy();
    current.trigger.setAttribute("aria-expanded", "false");
    if (restoreTriggerFocus && current.trigger.isConnected) current.trigger.focus();
  };

  const handleOverlayDismiss = (reason: OverlayDismissReason) => {
    closeDropdown(reason === "escape");
  };

  const openDropdown = (button: HTMLButtonElement, actionId: string, popupId: string) => {
    if (activeDropdown?.trigger === button) {
      activeDropdown.overlay.focusInitial();
      return;
    }
    closeDropdown();
    const overlayOptions = { id: popupId, onDismiss: handleOverlayDismiss };
    const overlay = actionId === "heading-menu"
      ? createHeadingMenu(editor, button, overlayOptions)
      : actionId === "text-color"
        ? createTextColorGrid(editor, button, overlayOptions)
        : createHighlightGrid(editor, button, overlayOptions);
    activeDropdown = { trigger: button, overlay };
    button.setAttribute("aria-expanded", "true");
    outsideHandler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!button.contains(target) && !overlay.element.contains(target)) closeDropdown();
    };
    toolbar.ownerDocument.addEventListener("mousedown", outsideHandler, true);
    overlay.focusInitial();
  };

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      const separator = document.createElement("div");
      separator.className = "nexus-toolbar-separator";
      separator.setAttribute("role", "separator");
      separator.setAttribute("aria-orientation", "vertical");
      separator.style.cssText = SEPARATOR_STYLES;
      toolbar.appendChild(separator);
    }

    for (const definition of group.buttons) {
      const button = document.createElement("button");
      button.className = "nexus-toolbar-btn";
      button.dataset.toolbarAction = definition.id;
      button.dataset.toolbarTooltip = definition.title;
      button.setAttribute("aria-label", definition.title);
      button.type = "button";
      button.tabIndex = -1;
      button.style.cssText = BUTTON_STYLES;
      button.appendChild(definition.icon());
      toolbarButtons.push(button);

      const cleanupTooltip = installToolbarTooltip(button);
      const handleMouseEnter = () => applyHover(button);
      const handleMouseLeave = () => clearHover(button);
      button.addEventListener("mouseenter", handleMouseEnter);
      button.addEventListener("mouseleave", handleMouseLeave);

      if (DROPDOWN_IDS.has(definition.id)) {
        const popupId = `nexus-toolbar-overlay-${++overlayId}`;
        button.setAttribute("aria-haspopup", definition.id === "heading-menu" ? "menu" : "grid");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", popupId);

        const toggleDropdown = () => {
          if (activeDropdown?.trigger === button) closeDropdown(true);
          else openDropdown(button, definition.id, popupId);
        };
        const handleClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          toggleDropdown();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            openDropdown(button, definition.id, popupId);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            toggleDropdown();
          } else if (event.key === "Escape" && activeDropdown?.trigger === button) {
            event.preventDefault();
            closeDropdown(true);
          } else if (event.key === "Tab" && activeDropdown?.trigger === button) {
            closeDropdown();
          }
        };
        button.addEventListener("click", handleClick);
        button.addEventListener("keydown", handleKeyDown);
        cleanupFns.push(() => {
          button.removeEventListener("click", handleClick);
          button.removeEventListener("keydown", handleKeyDown);
          button.removeEventListener("mouseenter", handleMouseEnter);
          button.removeEventListener("mouseleave", handleMouseLeave);
          cleanupTooltip();
        });
      } else {
        const handleClick = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          closeDropdown();
          definition.action(editor);
          editor.focus();
        };
        button.addEventListener("click", handleClick);
        cleanupFns.push(() => {
          button.removeEventListener("click", handleClick);
          button.removeEventListener("mouseenter", handleMouseEnter);
          button.removeEventListener("mouseleave", handleMouseLeave);
          cleanupTooltip();
        });
      }

      toolbar.appendChild(button);
    }
  });

  cleanupFns.push(installToolbarNavigation(toolbar, toolbarButtons));

  return {
    element: toolbar,
    destroy() {
      closeDropdown();
      for (const cleanup of cleanupFns) cleanup();
      cleanupFns.length = 0;
      toolbar.remove();
    },
  };
}
