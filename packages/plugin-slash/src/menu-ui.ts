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
}

export interface SlashMenuUI {
  /** The menu root element. Already mounted in the configured container. */
  element: HTMLElement;
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

// ========== 新增：注入基础样式（仅一次） ==========
let stylesInjected = false;

function injectBaseStyles(prefix: string) {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .${prefix}-menu {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.10);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      padding: 6px 0;
      min-width: 220px;
      max-height: 280px;
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      z-index: 1000;
    }
    .${prefix}-menu__item {
      position: relative;        /* 为快捷键绝对定位提供基准 */
      padding: 6px 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;    /* 保持 title 和 description 垂直排列 */
      line-height: 1.4;
      transition: background 0.15s;
    }
    .${prefix}-menu__item.is-active {
      background: #eef2f6;
    }
    .${prefix}-menu__item:hover {
      background: #f3f6fa;
    }
    .${prefix}-menu__title {
      font-weight: 500;
      color: #1e293b;
    }
    .${prefix}-menu__description {
      font-size: 0.8em;
      color: #64748b;
      margin-top: 1px;
    }
    .${prefix}-menu__shortcut {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.75em;
      color: #94a3b8;
      letter-spacing: 0.3px;
      pointer-events: none;      /* 防止干扰鼠标事件 */
    }
    .${prefix}-menu__empty {
      padding: 12px 16px;
      color: #94a3b8;
      text-align: center;
      font-size: 0.9em;
    }
  `;
  document.head.appendChild(style);
}
// =====================================================

export function createSlashMenuUI(
  editor: EditorAPI,
  options: SlashMenuUIOptions = {}
): SlashMenuUI {
  const prefix = options.classPrefix ?? DEFAULT_PREFIX;
  const offset = options.offset ?? DEFAULT_OFFSET;
  const container = options.container ?? document.body;
  const menuId = generateId(prefix);
  const commandHistory = createSlashCommandHistory(options.history);

  // 注入菜单基础样式
  injectBaseStyles(prefix);

  // ── DOM scaffolding ──────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = `${prefix}-menu`;
  root.id = menuId;
  root.setAttribute("role", "listbox");
  root.setAttribute("aria-label", "Slash commands");
  root.style.position = "fixed";
  root.style.display = "none";
  root.tabIndex = -1;
  container.appendChild(root);

  // ── Mutable state ────────────────────────────────────────────────
  let currentState: SlashMenuState | null = null;
  let visibleCommands: SlashCommandDef[] = [];
  let highlight = 0;
  let itemEls: HTMLDivElement[] = [];
  let isComposing = false;
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
      const empty = document.createElement("div");
      empty.className = `${prefix}-menu__empty`;
      empty.textContent = "No matches";
      root.appendChild(empty);
      root.removeAttribute("aria-activedescendant");
      return;
    }

    // Reconcile existing item nodes. Append missing, hide extras.
    while (itemEls.length < commands.length) {
      const item = document.createElement("div");
      item.className = `${prefix}-menu__item`;
      item.setAttribute("role", "option");
      item.id = `${menuId}-item-${itemEls.length}`;

      // ----- 新增：标题和描述（保持原有的两个子元素） -----
      const title = document.createElement("div");
      title.className = `${prefix}-menu__title`;
      const desc = document.createElement("div");
      desc.className = `${prefix}-menu__description`;
      item.appendChild(title);
      item.appendChild(desc);

      // ----- 新增：快捷键元素（第三个子元素） -----
      const shortcut = document.createElement("div");
      shortcut.className = `${prefix}-menu__shortcut`;
      // 稍后根据命令填充文本，这里先占位
      item.appendChild(shortcut);

      // 事件绑定（不变）
      const index = itemEls.length;
      item.addEventListener("mouseenter", () => {
        if (!isMenuOpen()) return;
        highlight = index;
        applyHighlight();
      });
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

    // 更新每个 item 的内容
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const item = itemEls[i];
      item.dataset.slashCommandId = cmd.id;

      // 因为子元素顺序固定：0-title, 1-description, 2-shortcut
      const children = item.children as unknown as HTMLDivElement[];
      const titleEl = children[0];
      const descEl = children[1];
      const shortcutEl = children[2];

      titleEl.textContent = cmd.title;
      if (cmd.description) {
        descEl.textContent = cmd.description;
        descEl.style.display = "";
      } else {
        descEl.textContent = "";
        descEl.style.display = "none";
      }

      // ----- 新增：设置快捷键文本（如果存在） -----
      const shortcut = (cmd as any).shortcut; // 安全读取自定义属性
      if (shortcut && typeof shortcut === "string") {
        shortcutEl.textContent = shortcut;
        shortcutEl.style.display = "";
      } else {
        shortcutEl.textContent = "";
        shortcutEl.style.display = "none";
      }
    }
  }

  function reposition(): void {
    if (!isMenuOpen() || !currentState) return;
    root.style.display = "block";
    if (!currentState.coords) return;
    const { left, top, bottom } = currentState.coords;
    root.style.left = `${left}px`;
    root.style.top = `${bottom + offset}px`;

    const rect = root.getBoundingClientRect();
    const winHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const winWidth = typeof window !== "undefined" ? window.innerWidth : 0;

    if (winHeight > 0 && rect.bottom > winHeight - VIEWPORT_MARGIN) {
      const flippedTop = top - rect.height - offset;
      if (flippedTop >= VIEWPORT_MARGIN) {
        root.style.top = `${flippedTop}px`;
      }
    }

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
      dismiss();
      return;
    }
    const cmd = cmds[highlight];
    const { from, to, query } = currentState;
    if (from !== null && to !== null) {
      editor.setSelection(from, to);
      editor.replaceSelection("");
    }
    editor.focus();

    const ctx: SlashMenuCommandContext = {
      trigger: { from: from ?? 0, to: to ?? 0, query },
      editor,
    };

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

    if (highlight >= state.commands.length) {
      highlight = Math.max(0, state.commands.length - 1);
    }

    show();
  }

  function onEditorBlur(): void {
    if (!isMenuOpen()) return;
    dismiss();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (destroyed) return;
    if (!isMenuOpen()) return;
    if (isComposing) return;

    const len = visibleCommands.length;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = (highlight + 1) % len;
          applyHighlight();
        }
        return;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = (highlight - 1 + len) % len;
          applyHighlight();
        }
        return;
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = 0;
          applyHighlight();
        }
        return;
      case "End":
        e.preventDefault();
        e.stopPropagation();
        if (len > 0) {
          highlight = len - 1;
          applyHighlight();
        }
        return;
      case "Enter":
      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        if (len === 0) {
          dismiss();
          return;
        }
        confirm();
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
    }
  }

  function onDocumentPointerDown(e: Event): void {
    if (destroyed) return;
    if (!isMenuOpen()) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (root.contains(target)) return;
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

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onDocumentPointerDown, true);
  if (typeof PointerEvent !== "undefined") {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
  }
  document.addEventListener("compositionstart", onCompositionStart, true);
  document.addEventListener("compositionend", onCompositionEnd, true);
  window.addEventListener("resize", onWindowResize);

  return {
    element: root,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off("slashMenuChange", onSlashMenuChange);
      editor.off("blur", onEditorBlur);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onDocumentPointerDown, true);
      if (typeof PointerEvent !== "undefined") {
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      }
      document.removeEventListener("compositionstart", onCompositionStart, true);
      document.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("resize", onWindowResize);
      if (root.parentNode) root.parentNode.removeChild(root);
      itemEls = [];
      currentState = null;
      visibleCommands = [];
    },
  };
}