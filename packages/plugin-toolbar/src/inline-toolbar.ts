import type { EditorAPI } from "@floatboat/nexus-core";

import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
} from "./toolbar-commands";
import {
  iconBold,
  iconItalic,
  iconStrikethrough,
  iconInlineCode,
  iconLink,
} from "./icons";
import type { ToolbarButton, ToolbarGroup } from "./toolbar-ui";

export type { ToolbarButton, ToolbarGroup } from "./toolbar-ui";

export interface InlineToolbarUIOptions {
  /**
   * Where to mount the toolbar root. Defaults to `document.body`. Shadow
   * DOM hosts can pass a `ShadowRoot` or the shadow host element.
   */
  container?: HTMLElement | ShadowRoot;
  /**
   * Override the default button groups. Pass an empty array to mount a
   * toolbar shell the host populates imperatively.
   */
  groups?: ToolbarGroup[];
  /**
   * Class-name prefix used to style the toolbar. Default: `"nexus-inline-toolbar"`.
   * Generated selectors:
   *   `.{prefix}`, `.{prefix}-btn`, `.{prefix}-separator`.
   */
  classPrefix?: string;
  /**
   * Vertical gap (in px) between the selection and the toolbar. Default: `6`.
   */
  offset?: number;
}

export interface InlineToolbarUI {
  /** The toolbar root element. Already mounted in the configured container. */
  element: HTMLElement;
  /** Force-show the toolbar (host imperative API; honors IME / dismiss latch). */
  show(): void;
  /** Force-hide the toolbar without arming the dismiss latch. */
  hide(): void;
  /**
   * Detach all DOM listeners, remove the element from its parent, and stop
   * reacting to editor events. Safe to call multiple times.
   */
  destroy(): void;
}

const DEFAULT_PREFIX = "nexus-inline-toolbar";
const DEFAULT_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

function defaultGroups(): ToolbarGroup[] {
  // Inline-only affordances. Block-level commands (headings, lists,
  // blockquote, code block) live in the persistent top toolbar — surfacing
  // them on a selection would mislead users into inserting a heading mid
  // document instead of toggling inline formatting on the highlighted text.
  return [
    {
      buttons: [
        { id: "bold", title: "Bold", icon: iconBold, action: toggleBold },
        { id: "italic", title: "Italic", icon: iconItalic, action: toggleItalic },
        { id: "strikethrough", title: "Strikethrough", icon: iconStrikethrough, action: toggleStrikethrough },
        { id: "inline-code", title: "Inline code", icon: iconInlineCode, action: toggleInlineCode },
        { id: "link", title: "Insert link", icon: iconLink, action: insertLink },
      ],
    },
  ];
}

const ROOT_STYLES = `
  position: fixed;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--nexus-bg, #fff);
  border: 1px solid var(--nexus-border, #eee);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 10000;
  user-select: none;
  font-family: system-ui, -apple-system, sans-serif;
`;

const BUTTON_STYLES = `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
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

export function createInlineToolbarUI(
  editor: EditorAPI,
  options: InlineToolbarUIOptions = {}
): InlineToolbarUI {
  const prefix = options.classPrefix ?? DEFAULT_PREFIX;
  const offset = options.offset ?? DEFAULT_OFFSET;
  const container = options.container ?? document.body;
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) {
    throw new TypeError("Inline toolbar container must belong to a window");
  }
  const groups = options.groups ?? defaultGroups();

  // ── DOM scaffolding ──────────────────────────────────────────────
  const root = ownerDocument.createElement("div");
  root.className = prefix;
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Inline formatting");
  root.style.cssText = ROOT_STYLES;
  // The toolbar must never become a focus target — the editor stays
  // focused throughout the toolbar lifecycle so keystrokes continue to
  // flow to CM6 after a button click, letting the user keep typing.
  root.tabIndex = -1;
  container.appendChild(root);

  // ── Render buttons once; groups are static for the toolbar lifetime ──
  groups.forEach((group, groupIdx) => {
    if (groupIdx > 0) {
      const sep = ownerDocument.createElement("div");
      sep.className = `${prefix}-separator`;
      sep.style.cssText = SEPARATOR_STYLES;
      root.appendChild(sep);
    }
    for (const btn of group.buttons) {
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = `${prefix}-btn`;
      button.dataset.inlineToolbarAction = btn.id;
      button.setAttribute("aria-label", btn.title);
      button.title = btn.title;
      button.style.cssText = BUTTON_STYLES;
      button.appendChild(btn.icon());

      const handleEnter = (): void => {
        button.style.background = "var(--nexus-bg-muted, #f0f0f0)";
        button.style.color = "var(--nexus-text, #24292e)";
      };
      const handleLeave = (): void => {
        button.style.background = "transparent";
        button.style.color = "var(--nexus-text-muted, #888)";
      };
      // mousedown default would move focus to the button and collapse
      // the selection before the click handler runs, leaving `action`
      // operating on an empty range. preventDefault keeps focus in the
      // editor and the selection intact.
      const handleMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
      };
      const handleClick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        btn.action(editor);
        // Re-evaluate visibility: most toggles preserve the selection,
        // but insertLink narrows it to the URL placeholder (3 chars,
        // still non-empty). A collapsed post-action selection hides
        // eagerly so we don't flash a one-frame toolbar on an empty
        // range before the next selectionChange arrives.
        refreshVisibility();
      };

      button.addEventListener("mouseenter", handleEnter);
      button.addEventListener("mouseleave", handleLeave);
      button.addEventListener("mousedown", handleMouseDown);
      button.addEventListener("click", handleClick);
      root.appendChild(button);
    }
  });

  // ── Mutable state ────────────────────────────────────────────────
  let visible = false;
  // `dismissed` is armed by Escape or outside-mousedown so a stray
  // re-emission of the same selection (e.g. cursor wiggle inside the
  // range) doesn't reopen the toolbar the user just dismissed. A fresh
  // non-empty selection clears it.
  let dismissed = false;
  let isComposing = false;
  let destroyed = false;

  // ── Positioning ──────────────────────────────────────────────────
  function reposition(): void {
    if (!visible) return;
    const { anchor, head } = editor.getSelection();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const startCoords = editor.getCoordsAtPos(from);
    const endCoords = editor.getCoordsAtPos(to);
    if (!startCoords || !endCoords) {
      // No coordinates (JSDOM, mid-flight layout). Leave the toolbar
      // wherever it last was — visibility is still asserted by tests.
      return;
    }
    const selLeft = Math.min(startCoords.left, endCoords.left);
    const selRight = Math.max(startCoords.right, endCoords.right);
    const selTop = Math.min(startCoords.top, endCoords.top);
    const selBottom = Math.max(startCoords.bottom, endCoords.bottom);
    const selCenterX = (selLeft + selRight) / 2;

    root.style.display = "flex";
    const rect = root.getBoundingClientRect();
    const winHeight = ownerWindow?.innerHeight ?? 0;
    const winWidth = ownerWindow?.innerWidth ?? 0;

    let left = selCenterX - rect.width / 2;
    let top = selTop - rect.height - offset;

    // Vertical flip: prefer above, fall back below when there's no
    // room. JSDOM returns zero-sized rects so this math is inert in
    // unit tests, but real browsers need it to keep the toolbar on
    // screen for selections at the top of the document.
    if (winHeight > 0 && top < VIEWPORT_MARGIN) {
      const flippedTop = selBottom + offset;
      // Only flip if it actually fits better — if neither fits (tiny
      // viewport), keep the original above position so the toolbar's
      // top stays attached to the selection.
      if (flippedTop + rect.height <= winHeight - VIEWPORT_MARGIN || flippedTop >= VIEWPORT_MARGIN) {
        top = flippedTop;
      }
    }

    // Horizontal clamp inside the viewport.
    if (winWidth > 0) {
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      if (left + rect.width > winWidth - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, winWidth - VIEWPORT_MARGIN - rect.width);
      }
    }

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  // ── Visibility ───────────────────────────────────────────────────
  function hasSelection(): boolean {
    return editor.getSelectedText() !== "";
  }

  function refreshVisibility(): void {
    if (destroyed) return;
    if (isComposing) {
      hide();
      return;
    }
    if (!hasSelection()) {
      hide();
      return;
    }
    if (dismissed) {
      hide();
      return;
    }
    show();
  }

  function show(): void {
    if (destroyed) return;
    visible = true;
    root.style.display = "flex";
    reposition();
  }

  function hide(): void {
    visible = false;
    root.style.display = "none";
  }

  function dismiss(): void {
    dismissed = true;
    hide();
  }

  // ── Event handlers ───────────────────────────────────────────────
  function onSelectionChange(): void {
    if (destroyed) return;
    // A non-empty selection is a fresh trigger — clear the dismiss
    // latch so the toolbar can re-show for a new range the user just
    // selected after an Escape.
    if (hasSelection()) dismissed = false;
    refreshVisibility();
  }

  function onEditorBlur(): void {
    if (!visible) return;
    dismiss();
  }

  function onDocumentPointerDown(e: Event): void {
    if (destroyed) return;
    if (!visible) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (root.contains(target)) return;
    // Anywhere outside the toolbar (including inside the editor)
    // dismisses. A subsequent selectionChange will reopen the toolbar
    // if the user selects a new non-empty range.
    dismiss();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (destroyed || !visible) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  }

  const documentKeyDown = (e: KeyboardEvent): void => onKeyDown(e);

  function onCompositionStart(): void {
    isComposing = true;
    // Hide eagerly — IME candidate windows shouldn't overlap a stale
    // toolbar pinned to the previous selection.
    if (visible) hide();
  }
  function onCompositionEnd(): void {
    isComposing = false;
    refreshVisibility();
  }

  function onWindowResize(): void {
    if (visible) reposition();
  }
  function onWindowScroll(): void {
    if (visible) reposition();
  }

  // ── Subscribe ────────────────────────────────────────────────────
  editor.on("selectionChange", onSelectionChange);
  editor.on("blur", onEditorBlur);

  // Capture phase so Escape pre-empts CM6 caret-motion keybinds.
  ownerDocument.addEventListener("keydown", documentKeyDown, true);
  // Both mousedown and pointerdown so we close as early as possible
  // regardless of input modality. Idempotent dismiss handles double
  // invocations safely.
  ownerDocument.addEventListener("mousedown", onDocumentPointerDown, true);
  if (typeof ownerWindow.PointerEvent !== "undefined") {
    ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true);
  }
  ownerDocument.addEventListener("compositionstart", onCompositionStart, true);
  ownerDocument.addEventListener("compositionend", onCompositionEnd, true);
  ownerWindow.addEventListener("resize", onWindowResize);
  // Scroll uses capture so a scrolling parent inside the host doesn't
  // bypass the toolbar's reposition pass.
  ownerWindow.addEventListener("scroll", onWindowScroll, true);

  return {
    element: root,
    show,
    hide,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("selectionChange", onSelectionChange);
      editor.off("blur", onEditorBlur);
      ownerDocument.removeEventListener("keydown", documentKeyDown, true);
      ownerDocument.removeEventListener("mousedown", onDocumentPointerDown, true);
      if (typeof ownerWindow.PointerEvent !== "undefined") {
        ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true);
      }
      ownerDocument.removeEventListener("compositionstart", onCompositionStart, true);
      ownerDocument.removeEventListener("compositionend", onCompositionEnd, true);
      ownerWindow.removeEventListener("resize", onWindowResize);
      ownerWindow.removeEventListener("scroll", onWindowScroll, true);
      if (root.parentNode) root.parentNode.removeChild(root);
      visible = false;
    },
  };
}
