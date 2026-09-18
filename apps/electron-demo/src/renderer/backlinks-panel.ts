import type { BacklinkHit, LinkIndexReader } from "./link-index";

import { t } from "./i18n";

export interface BacklinksPanelOptions {
  index: LinkIndexReader;
  onOpenFile(filePath: string): void;
  getActiveFile(): string | null;
  /** Maps the application's file path into the index namespace. */
  toIndexPath?(filePath: string): string | null;
  /** Maps an index hit back into the application's file path namespace. */
  fromIndexPath?(filePath: string): string | null;
}

export interface BacklinksPanel {
  element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function scheduleLowPriority(cb: () => void): () => void {
  const w = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 250 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 60);
  return () => clearTimeout(id);
}

const PANEL_STYLES = `
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  overflow: hidden;
`;

const HEADER_STYLES = `
  padding: 8px 10px;
  border-bottom: 1px solid var(--nexus-border, #eee);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  flex-shrink: 0;
`;

const SECTION_HEADER_STYLES = `
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--nexus-border-subtle, #f2f2f2);
  background: var(--nexus-bg, #fff);
  position: sticky;
  top: 0;
  z-index: 1;
`;

const LIST_STYLES = `
  flex: 1;
  overflow-y: auto;
`;

const EMPTY_STYLES = `
  padding: 8px 12px 12px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 12px;
  font-style: italic;
`;

const ITEM_STYLES = `
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 6px 10px;
  color: var(--nexus-text, #24292e);
  border-bottom: 1px solid var(--nexus-border-subtle, #f2f2f2);
`;

const ITEM_TITLE_STYLES = `
  font-weight: 600;
  font-size: 12px;
  color: var(--nexus-text, #24292e);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ITEM_SNIPPET_STYLES = `
  font-size: 12px;
  color: var(--nexus-text-muted, #666);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const BADGE_STYLES = `
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--nexus-bg-muted, #eef);
  color: var(--nexus-text-muted, #666);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
`;

export function createBacklinksPanel(options: BacklinksPanelOptions): BacklinksPanel {
  const {
    index,
    onOpenFile,
    getActiveFile,
    toIndexPath = (path) => path,
    fromIndexPath = (path) => path,
  } = options;

  const root = document.createElement("aside");
  root.className = "backlinks-panel";
  root.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  header.textContent = t("backlinks.title");
  root.appendChild(header);

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;
  root.appendChild(list);

  function renderSectionHeader(title: string, count: number, parent: HTMLElement): HTMLElement {
    const h = document.createElement("div");
    h.style.cssText = SECTION_HEADER_STYLES;
    renderSectionHeaderInto(h, title, count);
    parent.appendChild(h);
    return h;
  }

  function renderSectionHeaderInto(h: HTMLElement, title: string, count: number): void {
    h.textContent = "";
    const label = document.createElement("span");
    label.textContent = title;
    const badge = document.createElement("span");
    badge.style.cssText = BADGE_STYLES;
    badge.textContent = String(count);
    h.append(label, badge);
  }

  function renderItem(hit: BacklinkHit, parent: HTMLElement): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = ITEM_STYLES;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "var(--nexus-bg-muted, #f5f5f5)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
    });
    btn.addEventListener("click", () => {
      const path = fromIndexPath(hit.sourcePath);
      if (path) onOpenFile(path);
    });

    const title = document.createElement("div");
    title.style.cssText = ITEM_TITLE_STYLES;
    title.textContent = basename(hit.sourcePath);
    title.title = hit.sourcePath;
    btn.appendChild(title);

    const snippet = document.createElement("div");
    snippet.style.cssText = ITEM_SNIPPET_STYLES;
    snippet.textContent = hit.snippet || t("backlinks.empty");
    btn.appendChild(snippet);

    parent.appendChild(btn);
  }

  function renderEmpty(reason: string, parent: HTMLElement): void {
    const empty = document.createElement("div");
    empty.style.cssText = EMPTY_STYLES;
    empty.textContent = reason;
    parent.appendChild(empty);
  }

  let pendingUnlinkedCancel: (() => void) | null = null;
  let destroyed = false;

  function refresh(): void {
    if (destroyed) return;
    if (pendingUnlinkedCancel) {
      pendingUnlinkedCancel();
      pendingUnlinkedCancel = null;
    }
    list.textContent = "";
    const activeFile = getActiveFile();
    const active = activeFile ? toIndexPath(activeFile) : null;
    if (!activeFile || !active) {
      header.textContent = t("backlinks.title");
      renderEmpty(t("backlinks.noActiveFile"), list);
      return;
    }

    // Fast path: linked mentions are O(1) (Map lookup) — render immediately.
    const linked = index.getBacklinks(active);
    header.textContent = t("backlinks.summary", { linked: linked.length, unlinked: "…" });

    renderSectionHeader(t("backlinks.linkedMentions"), linked.length, list);
    if (linked.length === 0) {
      renderEmpty(t("backlinks.noLinked"), list);
    } else {
      for (const hit of linked) renderItem(hit, list);
    }

    // Placeholder for unlinked section — filled asynchronously so we don't
    // block the UI thread with the O(vault-size) regex scan in
    // getUnlinkedMentions.
    const unlinkedHeader = renderSectionHeader(t("backlinks.unlinkedMentions"), 0, list);
    unlinkedHeader.textContent = t("backlinks.unlinkedScanning");
    const unlinkedContainer = document.createElement("div");
    list.appendChild(unlinkedContainer);

    pendingUnlinkedCancel = scheduleLowPriority(() => {
      pendingUnlinkedCancel = null;
      // Bail if the active file changed while we were waiting.
      if (destroyed || getActiveFile() !== activeFile) return;
      const t0 = performance.now();
      const unlinked = index.getUnlinkedMentions(active);
      const t1 = performance.now();
      if ((globalThis as { NEXUS_PERF?: boolean }).NEXUS_PERF !== false && t1 - t0 > 5) {
        // eslint-disable-next-line no-console
        console.log("%c[perf]", "color:#0aa;font-weight:bold",
          "backlinks.unlinked-scan", `${(t1 - t0).toFixed(1)}ms`,
          { hits: unlinked.length });
      }
      header.textContent = t("backlinks.summary", { linked: linked.length, unlinked: unlinked.length });
      unlinkedHeader.textContent = "";
      renderSectionHeaderInto(unlinkedHeader, t("backlinks.unlinkedMentions"), unlinked.length);
      if (unlinked.length === 0) {
        renderEmpty(t("backlinks.noUnlinked"), unlinkedContainer);
      } else {
        for (const hit of unlinked) renderItem(hit, unlinkedContainer);
      }
    });
  }

  const unsubscribe = index.subscribe(() => refresh());
  refresh();

  return {
    element: root,
    refresh,
    destroy() {
      destroyed = true;
      if (pendingUnlinkedCancel) {
        pendingUnlinkedCancel();
        pendingUnlinkedCancel = null;
      }
      unsubscribe();
      root.remove();
    },
  };
}
