import type { EditorAPI, SlashCommandDef, SlashMenuState } from "@floatboat/nexus-core";
import {
  createSlashCommandHistory,
  type SlashCommandHistoryConfig,
  type SlashCommandHistoryOptions,
  type SlashCommandHistoryStorage,
} from "./command-history";
import {
  createSlashCommandOrder,
  type SlashCommandOrderConfig,
  type SlashCommandOrderOptions,
} from "./command-order";

export type {
  SlashCommandHistoryConfig,
  SlashCommandHistoryOptions,
  SlashCommandHistoryStorage,
  SlashCommandOrderConfig,
  SlashCommandOrderOptions,
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
   *   `.{prefix}-menu__item.is-dragging`,
   *   `.{prefix}-menu__handle`,
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
   * Opt-in manual reordering. `true` enables a session-only drag handle on
   * every item; an options object may provide host-injected storage so the
   * arrangement survives restarts.
   *
   * Manual placement is applied after `history`, so pinned commands win over
   * recency ordering. It only affects empty-query menus — while a query
   * filters the list there is nothing stable to reorder.
   */
  reorderable?: SlashCommandOrderConfig;
  /**
   * Register the legacy document-level key listener. Runtime hosts set this to
   * false and route keys through the EditorHost root dispatcher instead.
   */
  manageKeyboard?: boolean;
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
// Pointer travel (px) before a handle press becomes a reorder. Without a
// threshold, a plain click on the handle would nudge the row by a fraction
// of its height and reorder on release.
const DRAG_THRESHOLD_PX = 4;
// Rows slide to their new slot instead of jumping. Short enough to feel like
// direct manipulation rather than an animation the user waits on.
const REORDER_DURATION_MS = 140;
const REORDER_EASING = "cubic-bezier(0.2, 0, 0, 1)";

let uniqueIdCounter = 0;
function generateId(prefix: string): string {
  uniqueIdCounter += 1;
  return `${prefix}-menu-${uniqueIdCounter}`;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const GRIP_DOTS: ReadonlyArray<readonly [number, number]> = [
  [2, 3],
  [8, 3],
  [2, 8],
  [8, 8],
  [2, 13],
  [8, 13],
];

/**
 * Six-dot grip glyph. Sized inline because the package ships no stylesheet:
 * an unsized handle would render nothing and leave the drag with no hit area.
 */
function createGripIcon(ownerDocument: Document): SVGSVGElement {
  const icon = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("viewBox", "0 0 10 16");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "16");
  icon.setAttribute("fill", "currentColor");
  for (const [cx, cy] of GRIP_DOTS) {
    const dot = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "1.4");
    icon.appendChild(dot);
  }
  return icon;
}

export function createSlashMenuUI(
  editor: EditorAPI,
  options: SlashMenuUIOptions = {}
): SlashMenuUI {
  const prefix = options.classPrefix ?? DEFAULT_PREFIX;
  const offset = options.offset ?? DEFAULT_OFFSET;
  const container = options.container ?? document.body;
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new TypeError("Slash menu container must belong to a window");
  const menuId = generateId(prefix);
  const commandHistory = createSlashCommandHistory(options.history);
  const commandOrder = createSlashCommandOrder(options.reorderable);

  // ── DOM scaffolding ──────────────────────────────────────────────
  const root = ownerDocument.createElement("div");
  root.className = `${prefix}-menu`;
  root.id = menuId;
  root.setAttribute("role", "listbox");
  root.setAttribute("aria-label", "Slash commands");
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

  // Active reorder gesture. `fromIndex` is captured when the press starts so
  // a cancelled drag can be rewound; `currentIndex` tracks the row under the
  // pointer so `enter`/click handlers can keep highlighting the right element.
  let drag: {
    el: HTMLDivElement;
    fromIndex: number;
    currentIndex: number;
    startY: number;
    moved: boolean;
  } | null = null;
  // Frames scheduled by the slide animation, cancelled when the gesture ends
  // so a stale callback cannot repaint a row after cleanup.
  let flipFrames: number[] = [];

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
      empty.textContent = "No matches";
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

      if (commandOrder) {
        const handle = ownerDocument.createElement("div");
        handle.className = `${prefix}-menu__handle`;
        // Pointer-only affordance. Exposing a control keyboard users cannot
        // operate would be worse than hiding it, and an interactive child
        // inside role="option" is invalid ARIA.
        handle.setAttribute("aria-hidden", "true");
        // The package ships no stylesheet, so the grip is sized here: an
        // unsized element would leave the gesture with no hit area. Colours
        // stay on `currentColor` and the rest of the look belongs to the host.
        handle.style.cursor = "grab";
        handle.appendChild(createGripIcon(ownerDocument));
        // A press on the handle must not reach the item's click handler, or
        // releasing the handle would confirm the command.
        handle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        handle.addEventListener("mousedown", (e) => onHandleMouseDown(e, item));
        item.insertBefore(handle, title);
      }

      // Resolve the index at event time instead of capturing it. A reorder
      // moves the element to a new position, so an index captured at creation
      // would point at whichever command now occupies the old slot.
      item.addEventListener("mouseenter", () => {
        if (!isMenuOpen() || drag) return;
        const index = itemEls.indexOf(item);
        if (index < 0) return;
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
        if (drag) return;
        const index = itemEls.indexOf(item);
        if (index < 0) return;
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
      // Look the parts up by class: when a drag handle is present the item has
      // three children, so positional destructuring would pick the wrong node.
      const titleEl = item.querySelector<HTMLDivElement>(`.${prefix}-menu__title`);
      const descEl = item.querySelector<HTMLDivElement>(`.${prefix}-menu__description`);
      if (!titleEl || !descEl) continue;
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

  // ── Drag reordering ─────────────────────────────────────────────
  function prefersReducedMotion(): boolean {
    // Optional chaining because JSDOM and older embedded webviews do not
    // implement matchMedia; a missing API must mean "animate normally",
    // not "throw during a drag".
    return ownerWindow?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  /** Row geometry keyed by element, so a reorder cannot invalidate the lookup. */
  function measureRows(): Map<HTMLElement, number> {
    const tops = new Map<HTMLElement, number>();
    for (const el of itemEls) tops.set(el, el.getBoundingClientRect().top);
    return tops;
  }

  /**
   * FLIP slide for the rows that changed slot.
   *
   * Rows live in normal flow, so a reorder changes their layout position and a
   * CSS transition has nothing to interpolate. The transform is what gives the
   * move something to animate: invert to the old position first, then release
   * it on the next frame so the browser eases each row into its real slot.
   */
  function playRowSlide(before: Map<HTMLElement, number>): void {
    if (prefersReducedMotion()) return;

    const sliding: Array<{ el: HTMLDivElement; delta: number }> = [];
    for (const el of itemEls) {
      // The dragged row tracks the pointer instead; sliding it would fight
      // the offset applied in `followPointer`.
      if (el === drag?.el) continue;
      const previousTop = before.get(el);
      if (previousTop === undefined) continue;
      const delta = previousTop - el.getBoundingClientRect().top;
      if (delta === 0) continue;
      sliding.push({ el, delta });
    }
    if (sliding.length === 0) return;

    for (const { el, delta } of sliding) {
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
    }

    const frame = ownerWindow?.requestAnimationFrame(() => {
      for (const { el } of sliding) {
        el.style.transition = `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`;
        el.style.transform = "";
      }
    });
    if (frame !== undefined) flipFrames.push(frame);
  }

  /** Keeps the held row under the pointer while the list reflows around it. */
  function followPointer(clientY: number): void {
    const el = drag?.el;
    if (!el) return;
    // Measure with the transform cleared: getBoundingClientRect reports the
    // transformed box, so reading it while offset would make the offset chase
    // itself and collapse to zero.
    el.style.transform = "";
    const rect = el.getBoundingClientRect();
    el.style.transform = `translateY(${clientY - (rect.top + rect.height / 2)}px)`;
  }

  /** Drops every inline style the gesture applied, so hosts keep control. */
  function clearRowStyles(): void {
    for (const frame of flipFrames) ownerWindow?.cancelAnimationFrame(frame);
    flipFrames = [];
    for (const el of itemEls) {
      el.style.transition = "";
      el.style.transform = "";
    }
  }

  /**
   * Moves the command at `from` to `to` across `itemEls`, `visibleCommands`,
   * and the DOM, keeping the three in lockstep. Returns the resulting index
   * (clamped to the list bounds so a drag cannot escape the rendered rows).
   */
  function moveVisibleCommand(from: number, to: number): number {
    const count = itemEls.length;
    if (count < 2) return from;
    const target = Math.max(0, Math.min(to, count - 1));
    if (target === from) return from;

    const before = measureRows();
    const [item] = itemEls.splice(from, 1);
    itemEls.splice(target, 0, item);
    const [command] = visibleCommands.splice(from, 1);
    visibleCommands.splice(target, 0, command);

    // Re-seat every row in array order; appendChild moves an existing node.
    for (const el of itemEls) root.appendChild(el);
    playRowSlide(before);
    return target;
  }

  /** Index of the row the pointer is currently over, using row midpoints. */
  function resolveDropIndex(clientY: number): number {
    const count = itemEls.length;
    if (count === 0) return 0;
    for (let i = 0; i < count; i++) {
      const rect = itemEls[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return count - 1;
  }

  function onHandleMouseDown(event: MouseEvent, item: HTMLDivElement): void {
    if (!commandOrder || destroyed || drag) return;
    if (event.button !== 0) return;
    // A filtered list has no stable order to rearrange, and a menu that is
    // not open has nothing to rearrange at all.
    if (!isMenuOpen() || currentState?.query !== "") return;
    if (itemEls.length < 2) return;

    const index = itemEls.indexOf(item);
    if (index < 0) return;

    // Keep the text selection and the editor focus where they were, and stop
    // the item's own mousedown handler from treating this as a row press.
    event.preventDefault();
    event.stopPropagation();

    drag = {
      el: item,
      fromIndex: index,
      currentIndex: index,
      startY: event.clientY,
      moved: false,
    };

    // Capture phase on the document so the gesture survives the pointer
    // leaving the menu — a drop outside the element still commits.
    ownerDocument.addEventListener("mousemove", onDragMove, true);
    ownerDocument.addEventListener("mouseup", onDragEnd, true);
  }

  function onDragMove(event: MouseEvent): void {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.el.classList.add("is-dragging");
      // Draw the held row above its neighbours; it is offset out of its own
      // slot for the rest of the gesture.
      drag.el.style.zIndex = "1";
      drag.el.style.cursor = "grabbing";
    }
    // Resolve the drop target from layout, not from the held row's painted
    // box: `getBoundingClientRect` reports the transform, so leaving the
    // pointer offset in place would skew the row's own midpoint.
    drag.el.style.transform = "";
    const next = moveVisibleCommand(drag.currentIndex, resolveDropIndex(event.clientY));
    drag.currentIndex = next;
    // The dragged row is the active row: confirmation must follow what the
    // user sees under their pointer, not the pre-drag index.
    highlight = next;
    applyHighlight();
    followPointer(event.clientY);
    event.preventDefault();
  }

  function onDragEnd(_event: MouseEvent): void {
    if (!drag) return;
    const { moved, currentIndex } = drag;
    endDrag();
    if (!moved || !commandOrder) return;
    commandOrder.commit(visibleCommands.map((command) => command.id));
    highlight = currentIndex;
    applyHighlight();
  }

  function endDrag(): void {
    if (!drag) return;
    drag.el.classList.remove("is-dragging");
    ownerDocument.removeEventListener("mousemove", onDragMove, true);
    ownerDocument.removeEventListener("mouseup", onDragEnd, true);
    drag = null;
    clearRowStyles();
  }

  /** Abandons an in-flight drag without persisting, restoring the pre-drag order. */
  function cancelDrag(): void {
    if (!drag) return;
    const { fromIndex, currentIndex } = drag;
    endDrag();
    const restored = moveVisibleCommand(currentIndex, fromIndex);
    highlight = restored;
    applyHighlight();
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
    // A drag owns the rendered order until it ends. Re-rendering underneath
    // the pointer would rebuild the rows the gesture is tracking, so the
    // list is frozen while `drag` is set.
    if (drag) return;
    // Recency first, then manual placement on top: a command the user has
    // pinned outranks one that merely happens to be recent.
    const base = commandHistory
      ? commandHistory.reorder(currentState.commands, currentState.query)
      : currentState.commands;
    visibleCommands = commandOrder ? commandOrder.apply(base) : base;
    renderItems(visibleCommands);
    applyHighlight();
    reposition();
  }

  function hide(): void {
    // An in-flight drag is abandoned rather than committed: hiding the menu
    // is not a drop.
    cancelDrag();
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

    if (drag) {
      // A drag is in flight. When the incoming state still describes the same
      // unfiltered list, keep the gesture alive — `currentState` above already
      // refreshed the trigger range that `confirm()` reads. Anything else
      // invalidates the rows under the pointer, so the drag is abandoned
      // rather than continued against a list it no longer matches.
      if (state.query === "" && state.commands.length === visibleCommands.length) {
        return;
      }
      cancelDrag();
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

    if (drag && e.key !== "Escape") {
      // The drag owns the highlight for the duration of the gesture. Letting
      // navigation keys through would leave the active row pointing somewhere
      // other than the row under the pointer. Escape still cancels below.
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

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
      // Detach document-level drag listeners before the element is removed;
      // otherwise a gesture started before destroy would keep listening.
      endDrag();
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
