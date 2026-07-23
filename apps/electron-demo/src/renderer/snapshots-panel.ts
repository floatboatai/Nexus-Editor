import type { SnapshotMeta, SnapshotsPlugin } from "@floatboat/nexus-plugin-snapshots";

export interface SnapshotsPanelOptions {
  snapshots: SnapshotsPlugin;
  onError(message: string): void;
}

export interface SnapshotsPanel {
  element: HTMLElement;
  /** Re-read the list — needed when the active file (document key) changes. */
  refresh(): void;
  destroy(): void;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

const CAPTURE_BTN_STYLES = `
  border: 1px solid var(--nexus-border, #ddd);
  background: var(--nexus-bg, #fff);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--nexus-text, #24292e);
  text-transform: none;
  letter-spacing: 0;
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--nexus-border-subtle, #f2f2f2);
`;

const ITEM_BODY_STYLES = `
  flex: 1;
  min-width: 0;
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

const ITEM_META_STYLES = `
  font-size: 11px;
  color: var(--nexus-text-muted, #666);
`;

const ITEM_ACTION_STYLES = `
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  color: var(--nexus-text-muted, #666);
  border-radius: 4px;
`;

function formatSize(size: number): string {
  if (size < 1024) return `${size} chars`;
  return `${(size / 1024).toFixed(1)}k chars`;
}

export function createSnapshotsPanel(options: SnapshotsPanelOptions): SnapshotsPanel {
  const { snapshots, onError } = options;

  const root = document.createElement("aside");
  root.className = "snapshots-panel";
  root.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;

  const headerLabel = document.createElement("span");
  headerLabel.textContent = "Snapshots";

  const captureBtn = document.createElement("button");
  captureBtn.type = "button";
  captureBtn.style.cssText = CAPTURE_BTN_STYLES;
  captureBtn.textContent = "Capture now";
  captureBtn.title = "Take a snapshot of the current document";
  captureBtn.addEventListener("click", () => {
    void (async () => {
      const meta = await snapshots.capture();
      // De-dup makes "no new snapshot" a normal outcome, not an error.
      if (!meta) headerLabel.textContent = "Snapshots · unchanged";
    })().catch((err) => onError(err instanceof Error ? err.message : String(err)));
  });

  header.append(headerLabel, captureBtn);
  root.appendChild(header);

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;
  root.appendChild(list);

  let destroyed = false;

  function renderEmpty(reason: string): void {
    const empty = document.createElement("div");
    empty.style.cssText = EMPTY_STYLES;
    empty.textContent = reason;
    list.appendChild(empty);
  }

  function renderItem(meta: SnapshotMeta): void {
    const item = document.createElement("div");
    item.style.cssText = ITEM_STYLES;

    const body = document.createElement("div");
    body.style.cssText = ITEM_BODY_STYLES;

    const title = document.createElement("div");
    title.style.cssText = ITEM_TITLE_STYLES;
    title.textContent = meta.label ?? "Snapshot";

    const metaLine = document.createElement("div");
    metaLine.style.cssText = ITEM_META_STYLES;
    metaLine.textContent = `${new Date(meta.createdAt).toLocaleString()} · ${formatSize(meta.size)}`;

    body.append(title, metaLine);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.style.cssText = ITEM_ACTION_STYLES;
    restoreBtn.textContent = "⏪";
    restoreBtn.title = "Restore this snapshot (current content is kept as a safety snapshot)";
    restoreBtn.addEventListener("click", () => {
      const when = new Date(meta.createdAt).toLocaleString();
      if (!window.confirm(`Restore the snapshot from ${when}?\n\nThe current content will be kept as a safety snapshot.`)) {
        return;
      }
      void snapshots
        .restore(meta.id)
        .then((restored) => {
          if (!restored) onError("Snapshot no longer exists on disk.");
        })
        .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.style.cssText = ITEM_ACTION_STYLES;
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "Delete this snapshot";
    deleteBtn.addEventListener("click", () => {
      void snapshots
        .remove(meta.id)
        .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    });

    item.append(body, restoreBtn, deleteBtn);
    list.appendChild(item);
  }

  function render(metas: SnapshotMeta[]): void {
    if (destroyed) return;
    headerLabel.textContent = metas.length > 0 ? `Snapshots · ${metas.length}` : "Snapshots";
    list.textContent = "";
    if (metas.length === 0) {
      renderEmpty("No snapshots yet — capture one to start a version history.");
      return;
    }
    for (const meta of metas) renderItem(meta);
  }

  function refresh(): void {
    void snapshots
      .list()
      .then(render)
      .catch((err) => onError(err instanceof Error ? err.message : String(err)));
  }

  // subscribe keeps the panel live for capture/restore/remove; refresh()
  // covers document-key changes (file switches), which emit nothing.
  const unsubscribe = snapshots.subscribe(render);

  return {
    element: root,
    refresh,
    destroy() {
      destroyed = true;
      unsubscribe();
      root.remove();
    },
  };
}
