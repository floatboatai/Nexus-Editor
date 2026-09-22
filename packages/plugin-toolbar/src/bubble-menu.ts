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
import { applyTextColor, applyHighlight } from "./formatting";
import {
  iconBold,
  iconItalic,
  iconStrikethrough,
  iconUnderline,
  iconInlineCode,
  iconLink,
  iconTextColor,
  iconHighlight,
  iconH2,
  iconH3,
} from "./icons";
import {
  COLOR_PALETTE,
  HIGHLIGHT_PALETTE,
  pickOverlayMount,
  showColorPicker,
} from "./toolbar-ui";

export interface BubbleMenuButton {
  id: string;
  title: string;
  icon: () => HTMLElement;
  action: (editor: EditorAPI, event: MouseEvent, buttonEl: HTMLElement) => void;
}

export interface BubbleMenuUIOptions {
  /**
   * Custom buttons list for the bubble menu. When omitted, the default
   * rich formatting buttons (bold, italic, strikethrough, underline,
   * code, link, headings, color/highlight) are used.
   */
  buttons?: BubbleMenuButton[];
  /**
   * Target DOM node to mount the bubble menu overlay into. Defaults to
   * document.body or the current fullscreen container.
   */
  mount?: HTMLElement;
}

export interface BubbleMenuUI {
  element: HTMLElement;
  show(): void;
  hide(): void;
  updatePosition(): void;
  destroy(): void;
}

const BUBBLE_MENU_STYLES = `
  position: fixed;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--nexus-bg, #ffffff);
  border: 1px solid var(--nexus-border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.06);
  z-index: 10000;
  user-select: none;
  font-family: system-ui, -apple-system, sans-serif;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
`;

const BUBBLE_BUTTON_STYLES = `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nexus-text-muted, #4b5563);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
`;

const BUBBLE_SEPARATOR_STYLES = `
  width: 1px;
  height: 16px;
  background: var(--nexus-border-subtle, #e5e7eb);
  margin: 0 3px;
  flex-shrink: 0;
`;

export function defaultBubbleButtons(): BubbleMenuButton[] {
  return [
    { id: "bold", title: "Bold", icon: iconBold, action: (e) => toggleBold(e) },
    { id: "italic", title: "Italic", icon: iconItalic, action: (e) => toggleItalic(e) },
    { id: "strikethrough", title: "Strikethrough", icon: iconStrikethrough, action: (e) => toggleStrikethrough(e) },
    { id: "underline", title: "Underline", icon: iconUnderline, action: (e) => toggleWrap(e, "<u>") },
    { id: "inline-code", title: "Inline code", icon: iconInlineCode, action: (e) => toggleInlineCode(e) },
    { id: "link", title: "Insert link", icon: iconLink, action: (e) => insertLink(e) },
    { id: "h2", title: "Heading 2", icon: iconH2, action: (e) => toggleHeading(e, 2) },
    { id: "h3", title: "Heading 3", icon: iconH3, action: (e) => toggleHeading(e, 3) },
    {
      id: "text-color",
      title: "Text color",
      icon: iconTextColor,
      action: (e, _ev, btn) => {
        showColorPicker(e, btn, COLOR_PALETTE, applyTextColor, () => {});
      },
    },
    {
      id: "highlight",
      title: "Highlight",
      icon: iconHighlight,
      action: (e, _ev, btn) => {
        showColorPicker(e, btn, HIGHLIGHT_PALETTE, applyHighlight, () => {});
      },
    },
  ];
}

/**
 * Creates a floating rich-text Bubble Menu (Toolbar) that automatically
 * pops up above non-empty user text selections in the editor.
 */
export function createBubbleMenuUI(editor: EditorAPI, options?: BubbleMenuUIOptions): BubbleMenuUI {
  const buttons = options?.buttons ?? defaultBubbleButtons();
  const mountPoint = options?.mount ?? pickOverlayMount(document);

  const container = document.createElement("div");
  container.className = "nexus-bubble-menu";
  container.dataset.testId = "nexus-bubble-menu";
  container.style.cssText = BUBBLE_MENU_STYLES;

  let isVisible = false;
  let activeDropdown: { destroy: () => void } | null = null;

  // Build buttons
  buttons.forEach((btn, index) => {
    // Insert a separator before headings and before colors for clean grouping
    if (index === 6 || index === 8) {
      const sep = document.createElement("div");
      sep.style.cssText = BUBBLE_SEPARATOR_STYLES;
      container.appendChild(sep);
    }

    const buttonEl = document.createElement("button");
    buttonEl.type = "button";
    buttonEl.title = btn.title;
    buttonEl.setAttribute("aria-label", btn.title);
    buttonEl.dataset.testId = `bubble-menu-${btn.id}`;
    buttonEl.style.cssText = BUBBLE_BUTTON_STYLES;

    const iconEl = btn.icon();
    buttonEl.appendChild(iconEl);

    buttonEl.addEventListener("mouseenter", () => {
      buttonEl.style.background = "var(--nexus-bg-subtle, #f3f4f6)";
      buttonEl.style.color = "var(--nexus-text, #111827)";
    });
    buttonEl.addEventListener("mouseleave", () => {
      buttonEl.style.background = "transparent";
      buttonEl.style.color = "var(--nexus-text-muted, #4b5563)";
    });

    buttonEl.addEventListener("mousedown", (e) => {
      // Prevent button click from clearing CM6 text selection
      e.preventDefault();
    });

    buttonEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.action(editor, e, buttonEl);
      // Re-focus editor and update position
      editor.focus();
      updatePosition();
    });

    container.appendChild(buttonEl);
  });

  mountPoint.appendChild(container);

  function show(): void {
    if (isVisible) return;
    isVisible = true;
    container.style.opacity = "1";
    container.style.transform = "translateY(0)";
    container.style.pointerEvents = "auto";
  }

  function hide(): void {
    if (!isVisible) return;
    isVisible = false;
    container.style.opacity = "0";
    container.style.transform = "translateY(4px)";
    container.style.pointerEvents = "none";
    if (activeDropdown) {
      activeDropdown.destroy();
      activeDropdown = null;
    }
  }

  function updatePosition(): void {
    const sel = editor.getSelection();
    if (!sel || sel.anchor === sel.head) {
      hide();
      return;
    }

    const selectedText = editor.getSelectedText();
    if (!selectedText || selectedText.trim().length === 0) {
      hide();
      return;
    }

    const startPos = Math.min(sel.anchor, sel.head);
    const endPos = Math.max(sel.anchor, sel.head);

    const startCoords = editor.getCoordsAtPos(startPos);
    const endCoords = editor.getCoordsAtPos(endPos);

    if (!startCoords || !endCoords) {
      hide();
      return;
    }

    show();

    const menuRect = container.getBoundingClientRect();
    const menuWidth = menuRect.width || 260;
    const menuHeight = menuRect.height || 38;

    // Calculate center horizontal point
    const centerX = (startCoords.left + endCoords.right) / 2;
    let left = centerX - menuWidth / 2;

    // Boundary constraint within window width
    const minLeft = 8;
    const maxLeft = (typeof window !== "undefined" ? window.innerWidth : 1000) - menuWidth - 8;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    // Place menu 8px above the top-most line of selection
    const topSelection = Math.min(startCoords.top, endCoords.top);
    let top = topSelection - menuHeight - 8;

    // If placed too close to top of viewport, flip to below selection
    if (top < 8) {
      const bottomSelection = Math.max(startCoords.bottom, endCoords.bottom);
      top = bottomSelection + 8;
    }

    container.style.left = `${Math.round(left)}px`;
    container.style.top = `${Math.round(top)}px`;
  }

  const onSelectionChange = () => {
    updatePosition();
  };

  const onWindowScroll = () => {
    if (isVisible) updatePosition();
  };

  const onWindowResize = () => {
    if (isVisible) updatePosition();
  };

  const onDocumentMouseDown = (e: MouseEvent) => {
    if (!isVisible) return;
    const target = e.target as Node | null;
    if (target && !container.contains(target)) {
      // If clicking outside, check if selection is being collapsed
      setTimeout(() => updatePosition(), 20);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isVisible) {
      hide();
    }
  };

  editor.on("selectionChange", onSelectionChange);
  if (typeof window !== "undefined") {
    window.addEventListener("scroll", onWindowScroll, true);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onDocumentMouseDown);
  }

  return {
    element: container,
    show,
    hide,
    updatePosition,
    destroy() {
      hide();
      editor.off("selectionChange", onSelectionChange);
      if (typeof window !== "undefined") {
        window.removeEventListener("scroll", onWindowScroll, true);
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("mousedown", onDocumentMouseDown);
      }
      container.remove();
    },
  };
}
