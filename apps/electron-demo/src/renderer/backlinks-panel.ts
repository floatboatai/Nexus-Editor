import type { LinkIndex, BacklinkHit } from "./link-index";

export interface BacklinksPanelOptions {
  index: LinkIndex;
  onOpenFile(filePath: string): void;
  getActiveFile(): string | null;
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

export function createBacklinksPanel(options: BacklinksPanelOptions): BacklinksPanel {
  const { index, onOpenFile, getActiveFile } = options;

  const root = document.createElement("aside");
  root.className = "nx-rail nexus-backlinks-panel backlinks-panel";

  const header = document.createElement("div");
  header.className = "nx-panel-header";
  const headerTitle = document.createElement("div");
  headerTitle.className = "nx-panel-title";
  headerTitle.textContent = "Backlinks";
  header.appendChild(headerTitle);
  root.appendChild(header);

  const list = document.createElement("div");
  list.className = "nx-panel-body";
  root.appendChild(list);

  function renderSectionHeader(title: string, count: number, parent: HTMLElement): HTMLElement {
    const h = document.createElement("div");
    h.className = "nx-panel-title";
    h.style.cssText =
      "padding:8px 12px 4px;position:sticky;top:0;background:var(--ds-canvas);display:flex;align-items:center;gap:6px;";
    renderSectionHeaderInto(h, title, count);
    parent.appendChild(h);
    return h;
  }

  function renderSectionHeaderInto(h: HTMLElement, title: string, count: number): void {
    h.textContent = "";
    const label = document.createElement("span");
    label.textContent = title;
    const badge = document.createElement("span");
    badge.style.cssText =
      "display:inline-block;padding:1px 6px;border-radius:999px;background:var(--ds-surface-strong);color:var(--ds-muted);font-size:10px;font-weight:500;";
    badge.textContent = String(count);
    h.append(label, badge);
  }

  function renderItem(hit: BacklinkHit, parent: HTMLElement): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nx-tree-item";
    btn.style.cssText = "flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;";
    btn.addEventListener("click", () => onOpenFile(hit.sourcePath));

    const title = document.createElement("div");
    title.style.cssText =
      "font-weight:500;font-size:12px;color:var(--ds-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;";
    title.textContent = basename(hit.sourcePath);
    title.title = hit.sourcePath;
    btn.appendChild(title);

    const snippet = document.createElement("div");
    snippet.style.cssText =
      "font-size:12px;color:var(--ds-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;";
    snippet.textContent = hit.snippet || "(empty)";
    btn.appendChild(snippet);

    parent.appendChild(btn);
  }

  function renderEmpty(reason: string, parent: HTMLElement): void {
    const empty = document.createElement("div");
    empty.className = "nx-empty-hint";
    empty.textContent = reason;
    parent.appendChild(empty);
  }

  function setHeaderText(text: string): void {
    headerTitle.textContent = text;
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
    const active = getActiveFile();
    if (!active) {
      setHeaderText("Backlinks");
      renderEmpty("No active file", list);
      return;
    }

    // Fast path: linked mentions are O(1) (Map lookup) — render immediately.
    const linked = index.getBacklinks(active);
    setHeaderText(`Backlinks · ${linked.length} linked · … mentions`);

    renderSectionHeader("Linked mentions", linked.length, list);
    if (linked.length === 0) {
      renderEmpty("No linked mentions", list);
    } else {
      for (const hit of linked) renderItem(hit, list);
    }

    // Placeholder for unlinked section — filled asynchronously so we don't
    // block the UI thread with the O(vault-size) regex scan in
    // getUnlinkedMentions.
    const unlinkedHeader = renderSectionHeader("Unlinked mentions", 0, list);
    unlinkedHeader.textContent = "Unlinked mentions — scanning…";
    const unlinkedContainer = document.createElement("div");
    list.appendChild(unlinkedContainer);

    pendingUnlinkedCancel = scheduleLowPriority(() => {
      pendingUnlinkedCancel = null;
      // Bail if the active file changed while we were waiting.
      if (destroyed || getActiveFile() !== active) return;
      const t0 = performance.now();
      const unlinked = index.getUnlinkedMentions(active);
      const t1 = performance.now();
      if ((globalThis as { NEXUS_PERF?: boolean }).NEXUS_PERF !== false && t1 - t0 > 5) {
        // eslint-disable-next-line no-console
        console.log("%c[perf]", "color:#0aa;font-weight:bold",
          "backlinks.unlinked-scan", `${(t1 - t0).toFixed(1)}ms`,
          { hits: unlinked.length });
      }
      setHeaderText(
        `Backlinks · ${linked.length} linked · ${unlinked.length} mention${unlinked.length === 1 ? "" : "s"}`
      );
      unlinkedHeader.textContent = "";
      renderSectionHeaderInto(unlinkedHeader, "Unlinked mentions", unlinked.length);
      if (unlinked.length === 0) {
        renderEmpty("No unlinked mentions", unlinkedContainer);
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
