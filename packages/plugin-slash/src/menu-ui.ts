import { getLocale, resolveLocale, type NexusLocale } from "@floatboat/nexus-core";
import type { EditorAPI, SlashCommandDef, SlashMenuState } from "@floatboat/nexus-core";
import {
  createSlashCommandHistory,
  type SlashCommandHistoryConfig,
  type SlashCommandHistoryOptions,
  type SlashCommandHistoryStorage,
} from "./command-history";

export type {
  SlashCommandHistoryConfig,
  SlashCommandHistoryOptions,
  SlashCommandHistoryStorage,
};

export interface SlashMenuCommandContext {
  /**
   * The `/query` trigger range as it existed in the document before the
   * menu replaced it with an empty string. `query` is the text the user
   * had typed after the slash.
   */
  trigger: { from: number; to: number; query: string };
  /** The editor instance the menu is attached to. */
  editor: EditorAPI;
}

export type SlashMenuCommandHandler = (
  command: SlashCommandDef,
  context: SlashMenuCommandContext
) => void;

export interface SlashMenuUIOptions {
  /**
   * Where to mount the menu root. Defaults to `document.body`. Shadow
   * DOM hosts can pass a `ShadowRoot` or the shadow host element.
   */
  container?: HTMLElement | ShadowRoot;
  /**
   * Override the default command execution. When supplied, this runs
   * instead of `command.run`. The `/query` trigger has already been
   * removed from the document and the editor has been re-focused by
   * the time this callback fires.
   */
  onCommand?: SlashMenuCommandHandler;
  /**
   * Class-name prefix used to style the menu. Default: `"nexus-slash"`.
   * Generated selectors:
   *   `.{prefix}-menu`, `.{prefix}-menu__item`,
   *   `.{prefix}-menu__item.is-active`,
   *   `.{prefix}-menu__title`, `.{prefix}-menu__description`,
   *   `.{prefix}-menu__empty`.
   */
  classPrefix?: string;
  /**
   * Vertical offset (in px) between the caret line and the menu when
   * the menu opens below the caret. Default: `4`.
   */
  offset?: number;
  /**
   * Opt-in recently-used command ordering. `true` enables session-only
   * history; an options object may provide host-injected storage.
   */
  history?: SlashCommandHistoryConfig;
  /**
   * Register the legacy document-level key listener. Runtime hosts set this to
   * false and route keys through the EditorHost root dispatcher instead.
   */
  manageKeyboard?: boolean;
  /**
   * Override the menu chrome labels ("Slash commands", "No matches").
   * Defaults to the shared current locale.
   */
  locale?: Partial<NexusLocale>;
}

export interface SlashMenuUI {
  /** The menu root element. Already mounted in the configured container. */
  element: HTMLElement;
  /** Handle one key through the menu state machine; true means consumed. */
  handleKeydown(event: KeyboardEvent): boolean;
  /**
   * Detach all DOM listeners, remove the element from its parent, and
   * stop reacting to editor events. Safe to call multiple times.
   */
  destroy(): void;
}

const DEFAULT_PREFIX = "nexus-slash";
const DEFAULT_OFFSET = 4;
const VIEWPORT_MARGIN = 8;

let uniqueIdCounter = 0;
function generateId(prefix: string): string {
  uniqueIdCounter += 1;
  return `${prefix}-menu-${uniqueIdCounter}`;
}

export function createSlashMenuUI(
  editor: EditorAPI,
  options: SlashMenuUIOptions = {}
): SlashMenuUI {
  const prefix = options.classPrefix ?? DEFAULT_PREFIX;
  const offset = options.offset ?? DEFAULT_OFFSET;
  const locale = options.locale ? resolveLocale(options.locale) : getLocale();
  const container = options.container ?? document.body;
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new TypeError("Slash menu container must belong to a window");
  const menuId = generateId(prefix);
  const commandHistory = createSlashCommandHistory(options.history);

  // ── DOM scaffolding ──────────────────────────────────────────────
  const root = ownerDocument.createElement("div");
  root.className = `${prefix}-menu`;
  root.id = menuId;
  root.setAttribute("role", "listbox");
  root.setAttribute("aria-label", locale.slashMenuLabel);
  root.style.position = "fixed";
  root.style.display = "none";
  // The menu must not become a focus target — the editor stays focused
  // throughout the menu lifecycle so keystrokes continue to flow to CM6
  // while the menu intercepts navigation keys at document level.
  root.tabIndex = -1;
  container.appendChild(root);

  // ── Mutable state ────────────────────────────────────────────────
  let currentState: SlashMenuState | null = null;
  let visibleCommands: SlashCommandDef[] = [];
  let highlight = 0;
  // Items reused across renders to keep CSS transitions / focus rings
  // stable (rebuilding the list every keystroke would flicker active
  // styles even when the highlighted command does not change).
  let itemEls: HTMLDivElement[] = [];
  let isComposing = false;
  // `dismissed` is set when the user pressed Escape or clicked away;
  // it stays true until the state machine reports a fresh trigger
  // session (transitioning from closed → open). Without this latch,
  // re-emissions from the editor (e.g. cursor wiggle) would reopen the
  // menu the user just dismissed.
  let dismissed = false;
  let prevIsOpen = false;
  let destroyed = false;

  // ── Helpers ─────────────────────────────────────────────────────
  function isMenuOpen(): boolean {
    if (destroyed) return false;
    if (dismissed) return false;
    return currentState?.isOpen === true;
  }

  function applyHighlight(): void {
    for (let i = 0; i < itemEls.length; i++) {
      const isActive = i === highlight;
      const el = itemEls[i];
      el.classList.toggle("is-active", isActive);
      el.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    if (itemEls.length > 0 && highlight >= 0 && highlight < itemEls.length) {
      root.setAttribute("aria-activedescendant", itemEls[highlight].id);
    } else {
      root.removeAttribute("aria-activedescendant");
    }
  }

  function renderItems(commands: SlashCommandDef[]): void {
    if (commands.length === 0) {
      root.replaceChildren();
      itemEls = [];
      const empty = ownerDocument.createElement("div");
      empty.className = `${prefix}-menu__empty`;
      empty.textContent = locale.slashNoMatches;
      root.appendChild(empty);
      root.removeAttribute("aria-activedescendant");
      return;
    }

    // Reconcile existing item nodes. Append missing, hide extras.
    while (itemEls.length < commands.length) {
      const item = ownerDocument.createElement("div");
      item.className = `${prefix}-menu__item`;
      item.setAttribute("role", "option");
      item.id = `${menuId}-item-${itemEls.length}`;
      const title = ownerDocument.createElement("div");
      title.className = `${prefix}-menu__title`;
      const desc = ownerDocument.createElement("div");
      desc.className = `${prefix}-menu__description`;
      item.appendChild(title);
      item.appendChild(desc);

      const index = itemEls.length;
      // Hover sync: keyboard and mouse share the same highlight model.
      item.addEventListener("mouseenter", () => {
        if (!isMenuOpen()) return;
        highlight = index;
        applyHighlight();
      });
      // Confirm on click. preventDefault stops focus from leaving the
      // editor and stops CM6 from acting on the underlying mousedown.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      item.addEventListener("click", (e) => {
        e.preventDefault();
        highlight = index;
        confirm();
      });

      itemEls.push(item);
      root.appendChild(item);
    }
    while (itemEls.length > commands.length) {
      const dead = itemEls.pop();
      if (dead) root.removeChild(dead);
    }

    // Clear any stale empty-state placeholder.
    for (const child of Array.from(root.children)) {
      if (child.classList.contains(`${prefix}-menu__empty`)) {
        root.removeChild(child);
      }
    }

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const item = itemEls[i];
      item.dataset.slashCommandId = cmd.id;
      const [titleEl, descEl] = item.children as unknown as HTMLDivElement[];
      titleEl.textContent = cmd.title;
      if (cmd.description) {
        descEl.textContent = cmd.description;
        descEl.style.display = "";
      } else {
        descEl.textContent = "";
        descEl.style.display = "none";
      }
    }
  }

  function reposition(): void {
    if (!isMenuOpen() || !currentState) return;
    // The menu becomes visible regardless of whether coords are
    // available — keyboard navigation, screen-reader announcements,
    // and tests must work in coordinate-less environments (JSDOM,
    // headless layout-mid-flight). When coords are null we leave the
    // menu wherever it last was; the next emission with valid coords
    // will move it.
    root.style.display = "block";
    if (!currentState.coords) return;
    const { left, top, bottom } = currentState.coords;
    root.style.left = `${left}px`;
    root.style.top = `${bottom + offset}px`;

    const rect = root.getBoundingClientRect();
    const winHeight = ownerWindow?.innerHeight ?? 0;
    const winWidth = ownerWindow?.innerWidth ?? 0;

    // Vertical flip: if the menu would clip below the viewport, render
    // above the caret instead. JSDOM returns zero-sized rects, so this
    // branch is naturally inert in unit tests.
    if (winHeight > 0 && rect.bottom > winHeight - VIEWPORT_MARGIN) {
      const flippedTop = top - rect.height - offset;
      // Only flip if the flipped position fits better. If neither fits
      // (tiny viewport), prefer the original below position so the
      // first items remain visible.
      if (flippedTop >= VIEWPORT_MARGIN) {
        root.style.top = `${flippedTop}px`;
      }
    }

    // Horizontal clamp: keep the menu inside the right edge.
    if (winWidth > 0 && rect.right > winWidth - VIEWPORT_MARGIN) {
      const clamped = Math.max(VIEWPORT_MARGIN, winWidth - VIEWPORT_MARGIN - rect.width);
      root.style.left = `${clamped}px`;
    }
  }

  function show(): void {
    if (!currentState) return;
    visibleCommands = commandHistory
      ? commandHistory.reorder(currentState.commands, currentState.query)
      : currentState.commands;
    renderItems(visibleCommands);
    applyHighlight();
    reposition();
  }

  function hide(): void {
    root.style.display = "none";
  }

  function dismiss(): void {
    dismissed = true;
    hide();
  }

  function confirm(): void {
    if (!isMenuOpen() || !currentState) return;
    const cmds = visibleCommands;
    if (cmds.length === 0 || highlight < 0 || highlight >= cmds.length) {
      // Nothing valid to run; treat as dismiss so a stray Enter doesn't
      // leave the menu visible.
      dismiss();
      return;
    }
    const cmd = cmds[highlight];
    const { from, to, query } = currentState;
    // Remove the /query trigger before invoking run so commands that
    // insert content at the caret don't have to know about the slash
    // syntax. We select the trigger range first because
    // `replaceSelection` operates on the current selection.
    if (from !== null && to !== null) {
      editor.setSelection(from, to);
      editor.replaceSelection("");
    }
    editor.focus();

    const ctx: SlashMenuCommandContext = {
      trigger: { from: from ?? 0, to: to ?? 0, query },
      editor,
    };

    // Hide eagerly. The natural slashMenuChange that follows the doc
    // edit will also flip isOpen=false, but waiting for it would leave
    // the menu visible for one frame after confirm — visible as a
    // flash on slow paint paths.
    hide();
    currentState = null;
    visibleCommands = [];
    prevIsOpen = false;

    commandHistory?.record(cmd.id);

    if (options.onCommand) {
      options.onCommand(cmd, ctx);
    } else if (cmd.run) {
      cmd.run(editor);
    }
  }

  // ── Event handlers ──────────────────────────────────────────────
  function onSlashMenuChange(state: SlashMenuState): void {
    if (destroyed) return;
    // Reset the manual-dismiss latch whenever a fresh trigger session
    // begins (closed → open transition). Otherwise an Escape would
    // keep the menu suppressed forever for the rest of the editor's
    // lifetime.
    if (state.isOpen && !prevIsOpen) {
      dismissed = false;
      highlight = 0;
    }
    prevIsOpen = state.isOpen;
    currentState = state;

    if (!isMenuOpen()) {
      visibleCommands = [];
      hide();
      return;
    }

    // Clamp highlight if the command list shrank below it.
    if (highlight >= state.commands.length) {
      highlight = Math.max(0, state.commands.length - 1);
    }

    show();
  }

  function onEditorBlur(): void {
    // Lose-focus dismissal is unconditional. The editor losing focus
    // means another panel or app grabbed it; the menu has no business
    // staying open.
    if (!isMenuOpen()) return;
    dismiss();
  }

  function onKeyDown(e: KeyboardEvent): boolean {
    if (destroyed || !isMenuOpen() || isComposing) return false;

    const len = visibleCommands.length;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = (highlight + 1) % len;
          applyHighlight();
        }
        return true;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = (highlight - 1 + len) % len;
          applyHighlight();
        }
        return true;
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = 0;
          applyHighlight();
        }
        return true;
      case "End":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = len - 1;
          applyHighlight();
        }
        return true;
      case "Enter":
      case "Tab":
        // Empty results: swallow Enter so the editor doesn't insert a
        // newline below the trigger. Treat as a no-op dismiss.
        e.preventDefault();
        e.stopPropagation();
        if (len === 0) {
          dismiss();
          return true;
        }
        confirm();
        return true;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return true;
    }
    return false;
  }

  const documentKeyDown = (event: KeyboardEvent): void => {
    onKeyDown(event);
  };

  function onDocumentPointerDown(e: Event): void {
    if (destroyed) return;
    if (!isMenuOpen()) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (root.contains(target)) return;
    // Anywhere outside the menu (including inside the editor) dismisses.
    // The editor's own click will then reposition the caret normally;
    // a subsequent slashMenuChange may reopen the menu if the user
    // clicked inside a new `/query` token.
    dismiss();
  }

  function onCompositionStart(): void {
    isComposing = true;
  }
  function onCompositionEnd(): void {
    isComposing = false;
  }

  function onWindowResize(): void {
    if (!isMenuOpen()) return;
    reposition();
  }

  // ── Subscribe ────────────────────────────────────────────────────
  editor.on("slashMenuChange", onSlashMenuChange);
  editor.on("blur", onEditorBlur);

  // Capture phase: we need to handle Enter / Escape / ArrowKeys before
  // CM6's own keymap binds them to caret motion.
  if (options.manageKeyboard !== false) {
    ownerDocument.addEventListener("keydown", documentKeyDown, true);
  }
  // Use both mousedown and pointerdown so we close as early as
  // possible regardless of input modality. Idempotent dismiss handles
  // double invocations safely.
  ownerDocument.addEventListener("mousedown", onDocumentPointerDown, true);
  if (typeof ownerWindow.PointerEvent !== "undefined") {
    ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true);
  }
  ownerDocument.addEventListener("compositionstart", onCompositionStart, true);
  ownerDocument.addEventListener("compositionend", onCompositionEnd, true);
  ownerWindow.addEventListener("resize", onWindowResize);

  return {
    element: root,
    handleKeydown: onKeyDown,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("slashMenuChange", onSlashMenuChange);
      editor.off("blur", onEditorBlur);
      if (options.manageKeyboard !== false) {
        ownerDocument.removeEventListener("keydown", documentKeyDown, true);
      }
      ownerDocument.removeEventListener("mousedown", onDocumentPointerDown, true);
      if (typeof ownerWindow.PointerEvent !== "undefined") {
        ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true);
      }
      ownerDocument.removeEventListener("compositionstart", onCompositionStart, true);
      ownerDocument.removeEventListener("compositionend", onCompositionEnd, true);
      ownerWindow.removeEventListener("resize", onWindowResize);
      if (root.parentNode) root.parentNode.removeChild(root);
      itemEls = [];
      currentState = null;
      visibleCommands = [];
    },
  };
}
