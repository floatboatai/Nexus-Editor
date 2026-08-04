/**
 * Recent-projects quick switcher — a centered modal listing recently opened
 * vaults. Existing projects switch on click / Enter; projects whose folder was
 * moved or deleted are shown dimmed with a friendly hint and a one-click
 * "Remove" so the list self-heals. Keyboard: ↑/↓ to move, Enter to open, Esc
 * to close.
 *
 * Data comes from `vault.listRecents()`, which (unlike `getLast`) preserves
 * dead entries and flags them `exists: false` — that's what lets us warn
 * instead of silently dropping them.
 */
import { iconEl } from "./icons";

export interface ProjectSwitcherOptions {
  /** Switch to an existing vault path. */
  onSwitch(path: string): void;
  /** Open the native folder picker (empty state / "Open another…"). */
  onPickNew(): void;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/** Open the switcher. Self-managed: builds fresh, tears down on close. */
export async function openProjectSwitcher(options: ProjectSwitcherOptions): Promise<void> {
  // Only one at a time.
  document.querySelectorAll(".nx-switcher").forEach((el) => el.remove());

  const backdrop = document.createElement("div");
  backdrop.className = "nx-switcher";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Switch project");

  const panel = document.createElement("div");
  panel.className = "nx-switcher__panel";
  backdrop.appendChild(panel);

  const header = document.createElement("div");
  header.className = "nx-switcher__header";
  const heading = document.createElement("div");
  heading.className = "nx-switcher__title";
  heading.textContent = "Recent projects";
  header.appendChild(heading);
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "nx-switcher__list";
  list.setAttribute("role", "listbox");
  panel.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "nx-switcher__footer";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "nx-btn nx-btn--ghost";
  openBtn.textContent = "Open another folder…";
  footer.appendChild(openBtn);
  panel.appendChild(footer);

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("is-open"));

  let items: RecentVault[] = [];
  // Index into the SELECTABLE (existing) rows only — missing rows aren't
  // keyboard-focusable since Enter can't open them.
  let selectable: RecentVault[] = [];
  let active = 0;

  function close(): void {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }

  function choose(path: string): void {
    close();
    options.onSwitch(path);
  }

  function highlight(): void {
    const rows = list.querySelectorAll<HTMLElement>(".nx-switcher__row[data-selectable='1']");
    rows.forEach((row, i) => row.classList.toggle("is-active", i === active));
    // scrollIntoView is absent in some environments (jsdom); guard it.
    rows[active]?.scrollIntoView?.({ block: "nearest" });
  }

  function onKey(e: KeyboardEvent): void {
    // Capture-phase + stopPropagation so navigation keys don't leak to the
    // CodeMirror editor underneath while the modal is open.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (selectable.length) active = (active + 1) % selectable.length;
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (selectable.length) active = (active - 1 + selectable.length) % selectable.length;
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const target = selectable[active];
      if (target) choose(target.path);
    }
  }
  document.addEventListener("keydown", onKey, true);

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  openBtn.addEventListener("click", () => {
    close();
    options.onPickNew();
  });

  async function refresh(): Promise<void> {
    let activeVault: string | null = null;
    try {
      const res = await window.nexusDemo.vault.listRecents();
      items = res.recents;
      activeVault = res.activeVault;
    } catch {
      items = [];
    }
    render(activeVault);
  }

  function render(activeVault: string | null): void {
    list.textContent = "";
    selectable = items.filter((r) => r.exists);
    active = 0;

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "nx-switcher__empty";
      empty.textContent = "No recent projects yet. Open a folder to get started.";
      list.appendChild(empty);
      return;
    }

    for (const entry of items) {
      list.appendChild(buildRow(entry, entry.path === activeVault));
    }
    highlight();
  }

  function buildRow(entry: RecentVault, isCurrent: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "nx-switcher__row";
    row.classList.toggle("is-missing", !entry.exists);
    if (entry.exists) row.dataset.selectable = "1";
    row.setAttribute("role", "option");

    const icon = document.createElement("span");
    icon.className = "nx-switcher__icon";
    icon.appendChild(iconEl(entry.exists ? "folder" : "close"));
    row.appendChild(icon);

    const text = document.createElement("div");
    text.className = "nx-switcher__text";
    const name = document.createElement("div");
    name.className = "nx-switcher__name";
    name.textContent = entry.name || basename(entry.path);
    const sub = document.createElement("div");
    sub.className = "nx-switcher__path";
    sub.textContent = entry.exists ? entry.path : "Folder moved or deleted";
    sub.title = entry.path;
    text.append(name, sub);
    row.appendChild(text);

    if (isCurrent && entry.exists) {
      const tag = document.createElement("span");
      tag.className = "nx-switcher__tag";
      tag.textContent = "Current";
      row.appendChild(tag);
    }

    if (entry.exists) {
      row.addEventListener("click", () => choose(entry.path));
      row.addEventListener("mouseenter", () => {
        const idx = selectable.indexOf(entry);
        if (idx >= 0) {
          active = idx;
          highlight();
        }
      });
    } else {
      // Dead project: offer a friendly one-click removal instead of switching.
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "nx-btn nx-btn--ghost nx-switcher__remove";
      remove.textContent = "Remove";
      remove.title = "Remove from recent projects";
      remove.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await window.nexusDemo.vault.removeRecent(entry.path);
        } catch {
          /* best-effort — refresh reflects whatever persisted */
        }
        await refresh();
      });
      row.appendChild(remove);
    }

    return row;
  }

  await refresh();
}
