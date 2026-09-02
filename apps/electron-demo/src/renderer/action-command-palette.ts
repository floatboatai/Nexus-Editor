/**
 * Host-level action / command search (VS Code Ctrl+Shift+P style).
 * Searches registered UI actions — not document text.
 */

export interface ActionCommand {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  category?: string;
  run: () => void;
}

export interface ActionCommandPalette {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

/** Ordered-subsequence fuzzy score; higher is better. -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    if (found === ti) {
      consecutive += 1;
      score += 10 + consecutive;
    } else {
      consecutive = 0;
      score += Math.max(1, 8 - (found - ti));
    }
    if (found === 0 || /[\s\-_/]/.test(t[found - 1]!)) score += 6;
    ti = found + 1;
  }
  // Prefer tighter matches, but never demote a successful hit below 1.
  return Math.max(1, score - Math.max(0, t.length - q.length));
}

export function filterActionCommands(
  commands: readonly ActionCommand[],
  query: string,
): ActionCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.slice();

  const scored: Array<{ cmd: ActionCommand; score: number }> = [];
  for (const cmd of commands) {
    const haystacks = [
      cmd.title,
      cmd.description ?? "",
      cmd.category ?? "",
      ...(cmd.keywords ?? []),
    ];
    let best = -1;
    for (const h of haystacks) {
      const s = fuzzyScore(q, h);
      if (s > best) best = s;
    }
    if (best >= 0) scored.push({ cmd, score: best });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.cmd.title.localeCompare(b.cmd.title);
  });
  return scored.map((s) => s.cmd);
}

export interface CreateActionCommandPaletteOptions {
  getCommands: () => readonly ActionCommand[];
  /** Host document; defaults to `document`. */
  ownerDocument?: Document;
}

export function createActionCommandPalette(
  options: CreateActionCommandPaletteOptions,
): ActionCommandPalette {
  const ownerDocument = options.ownerDocument ?? document;
  let open = false;
  let destroyed = false;
  let activeIndex = 0;
  let filtered: ActionCommand[] = [];

  const backdrop = ownerDocument.createElement("div");
  backdrop.className = "nexus-action-palette";
  backdrop.setAttribute("role", "presentation");
  backdrop.hidden = true;

  const dialog = ownerDocument.createElement("div");
  dialog.className = "nexus-action-palette__dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Command palette");

  const input = ownerDocument.createElement("input");
  input.className = "nexus-action-palette__input";
  input.type = "text";
  input.placeholder = "Search actions… (theme, preview, settings, panels)";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "nexus-action-palette-list");

  const hint = ownerDocument.createElement("div");
  hint.className = "nexus-action-palette__hint";
  hint.textContent = "↑↓ navigate · Enter run · Esc close · searches UI actions, not document text";

  const list = ownerDocument.createElement("ul");
  list.className = "nexus-action-palette__list";
  list.id = "nexus-action-palette-list";
  list.setAttribute("role", "listbox");

  dialog.append(input, hint, list);
  backdrop.appendChild(dialog);
  ownerDocument.body.appendChild(backdrop);

  const renderList = () => {
    list.replaceChildren();
    if (filtered.length === 0) {
      const empty = ownerDocument.createElement("li");
      empty.className = "nexus-action-palette__empty";
      empty.textContent = "No matching actions";
      list.appendChild(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }

    if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
    if (activeIndex < 0) activeIndex = 0;

    filtered.forEach((cmd, index) => {
      const item = ownerDocument.createElement("li");
      item.className = "nexus-action-palette__item";
      item.id = `nexus-action-palette-item-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
      if (index === activeIndex) item.classList.add("is-active");

      const title = ownerDocument.createElement("div");
      title.className = "nexus-action-palette__title";
      title.textContent = cmd.title;

      const meta = ownerDocument.createElement("div");
      meta.className = "nexus-action-palette__meta";
      const parts = [cmd.category, cmd.description].filter(Boolean);
      meta.textContent = parts.join(" · ");

      item.append(title);
      if (parts.length > 0) item.append(meta);

      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        runCommand(cmd);
      });
      list.appendChild(item);
    });

    input.setAttribute("aria-activedescendant", `nexus-action-palette-item-${activeIndex}`);
    const activeEl = list.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView?.({ block: "nearest" });
  };

  const refresh = () => {
    filtered = filterActionCommands(options.getCommands(), input.value);
    renderList();
  };

  const close = () => {
    if (!open || destroyed) return;
    open = false;
    backdrop.hidden = true;
    input.value = "";
    filtered = [];
    activeIndex = 0;
    list.replaceChildren();
  };

  const runCommand = (cmd: ActionCommand) => {
    close();
    try {
      cmd.run();
    } catch (error) {
      // Surface in console so host status can still be updated by callers.
      // eslint-disable-next-line no-console
      console.error("[action-palette]", cmd.id, error);
    }
  };

  const openPalette = () => {
    if (destroyed) return;
    open = true;
    backdrop.hidden = false;
    activeIndex = 0;
    input.value = "";
    refresh();
    input.focus();
    input.select();
  };

  const onInput = () => {
    activeIndex = 0;
    refresh();
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = (activeIndex + 1) % filtered.length;
      renderList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      renderList();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      activeIndex = 0;
      renderList();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      activeIndex = Math.max(0, filtered.length - 1);
      renderList();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) runCommand(cmd);
    }
  };

  const onBackdropPointer = (event: MouseEvent) => {
    if (event.target === backdrop) close();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  backdrop.addEventListener("mousedown", onBackdropPointer);

  return {
    open: openPalette,
    close,
    isOpen: () => open,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      backdrop.removeEventListener("mousedown", onBackdropPointer);
      backdrop.remove();
    },
  };
}
