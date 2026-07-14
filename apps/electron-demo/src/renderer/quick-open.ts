import { fuzzyFilter, type FuzzyFilterResult } from "@floatboat/nexus-plugin-search";
import { normalizeSlashes } from "./path-utils";

export interface QuickOpenOptions {
  /** Absolute paths of the files to offer. Read fresh on every open. */
  getFiles: () => string[];
  /** Current vault root, used to shorten displayed paths. */
  getVaultPath: () => string | null;
  /** Open the chosen file (absolute path). */
  onOpenFile: (path: string) => void;
  /** Max results to render. Defaults to 50. */
  limit?: number;
}

export interface QuickOpen {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

interface Candidate {
  path: string;
  label: string;
}

/**
 * Vault-relative, forward-slashed display label for an absolute file path.
 * Falls back to the full normalized path when the file is outside the vault.
 */
export function toVaultRelative(absPath: string, vaultPath: string | null): string {
  const p = normalizeSlashes(absPath);
  if (!vaultPath) return p;
  const base = normalizeSlashes(vaultPath).replace(/\/+$/, "");
  if (p.toLowerCase() === base.toLowerCase()) return p;
  if (p.toLowerCase().startsWith(base.toLowerCase() + "/")) {
    return p.slice(base.length + 1);
  }
  return p;
}

const OVERLAY_STYLES = `
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: none;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.35);
`;

const PANEL_STYLES = `
  width: min(640px, 90vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  border: 1px solid var(--nexus-border, #ddd);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
`;

const INPUT_STYLES = `
  border: none;
  border-bottom: 1px solid var(--nexus-border, #eee);
  outline: none;
  padding: 12px 14px;
  font-size: 15px;
  font-family: inherit;
  background: transparent;
  color: inherit;
  flex-shrink: 0;
`;

const LIST_STYLES = `
  overflow-y: auto;
  padding: 6px 0;
`;

const ITEM_BASE = `
  display: block;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--nexus-text, #24292e);
`;

const ACTIVE_BG = "var(--nexus-bg-muted, #eef1f4)";

const EMPTY_STYLES = `
  padding: 18px 14px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 13px;
  font-style: italic;
`;

const MATCH_STYLES = "color: var(--nexus-accent, #0969da); font-weight: 600;";

/** Append `label` to `parent`, wrapping matched character runs in a highlight. */
function renderLabel(parent: HTMLElement, label: string, positions: number[]): void {
  const matched = new Set(positions);
  let i = 0;
  while (i < label.length) {
    const isMatch = matched.has(i);
    let j = i;
    while (j < label.length && matched.has(j) === isMatch) j++;
    const run = label.slice(i, j);
    if (isMatch) {
      const mark = document.createElement("span");
      mark.style.cssText = MATCH_STYLES;
      mark.textContent = run;
      parent.appendChild(mark);
    } else {
      parent.appendChild(document.createTextNode(run));
    }
    i = j;
  }
}

export function createQuickOpen(options: QuickOpenOptions): QuickOpen {
  const limit = options.limit ?? 50;

  const overlay = document.createElement("div");
  overlay.className = "nexus-quick-open";
  overlay.dataset.testId = "quick-open";
  overlay.style.cssText = OVERLAY_STYLES;

  const panel = document.createElement("div");
  panel.style.cssText = PANEL_STYLES;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Quick open file");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Go to file...";
  input.setAttribute("aria-label", "Go to file");
  input.dataset.testId = "quick-open-input";
  input.style.cssText = INPUT_STYLES;

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;
  list.setAttribute("role", "listbox");

  panel.append(input, list);
  overlay.append(panel);

  let candidates: Candidate[] = [];
  let results: FuzzyFilterResult<Candidate>[] = [];
  let rows: HTMLElement[] = [];
  let activeIndex = 0;
  let visible = false;

  function refreshCandidates(): void {
    const vaultPath = options.getVaultPath();
    candidates = options
      .getFiles()
      .map((path) => ({ path, label: toVaultRelative(path, vaultPath) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function setActive(index: number): void {
    if (rows.length === 0) return;
    activeIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows.forEach((row, i) => {
      const on = i === activeIndex;
      row.style.background = on ? ACTIVE_BG : "transparent";
      row.setAttribute("aria-selected", String(on));
      if (on && typeof row.scrollIntoView === "function") {
        try {
          row.scrollIntoView({ block: "nearest" });
        } catch {
          // jsdom / non-DOM hosts don't implement scrollIntoView — non-fatal.
        }
      }
    });
  }

  function renderList(): void {
    list.innerHTML = "";
    rows = [];

    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent = candidates.length === 0 ? "No files — open a vault first" : "No matching files";
      list.appendChild(empty);
      return;
    }

    results.forEach((result, index) => {
      const row = document.createElement("div");
      row.dataset.testId = "quick-open-item";
      row.style.cssText = ITEM_BASE;
      row.setAttribute("role", "option");
      row.title = result.item.label;
      renderLabel(row, result.item.label, result.positions);
      row.addEventListener("mousemove", () => setActive(index));
      row.addEventListener("click", () => choose(index));
      list.appendChild(row);
      rows.push(row);
    });

    setActive(0);
  }

  function runFilter(): void {
    results = fuzzyFilter(candidates, input.value, { key: (c) => c.label, limit });
    renderList();
  }

  function choose(index: number): void {
    const result = results[index];
    if (!result) return;
    close();
    options.onOpenFile(result.item.path);
  }

  input.addEventListener("input", runFilter);
  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive(activeIndex - 1);
        break;
      case "Enter":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
    }
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  function open(): void {
    visible = true;
    overlay.style.display = "flex";
    refreshCandidates();
    input.value = "";
    runFilter();
    input.focus();
  }

  function close(): void {
    if (!visible) return;
    visible = false;
    overlay.style.display = "none";
  }

  return {
    element: overlay,
    open,
    close,
    isOpen: () => visible,
    destroy() {
      close();
      overlay.remove();
    }
  };
}
