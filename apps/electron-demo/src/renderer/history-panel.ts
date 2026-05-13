import type { SnapshotEntry } from "../../electron/snapshots";

export interface HistoryPanelOptions {
  getSnapshots(): SnapshotEntry[];
  onRestore(snapshot: SnapshotEntry): void;
  onReuse(snapshot: SnapshotEntry): void;
}

export interface HistoryPanel {
  element: HTMLElement;
  update(): void;
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
`;

const LIST_STYLES = `
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
`;

const EMPTY_STYLES = `
  padding: 16px 12px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 12px;
  font-style: italic;
`;

const ITEM_STYLES = `
  border-bottom: 1px solid var(--nexus-border-subtle, #f2f2f2);
  padding: 10px 12px;
`;

const TITLE_STYLES = `
  font-size: 13px;
  font-weight: 600;
  color: var(--nexus-text, #24292e);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const META_STYLES = `
  font-size: 11px;
  color: var(--nexus-text-muted, #666);
  margin-bottom: 6px;
`;

const SUMMARY_STYLES = `
  font-size: 12px;
  color: var(--nexus-text, #444);
  margin-bottom: 8px;
  line-height: 1.4;
`;

const ACTION_ROW_STYLES = `
  display: flex;
  gap: 8px;
`;

const ACTION_BTN_STYLES = `
  border: 1px solid var(--nexus-border, #ddd);
  background: var(--nexus-bg, #fff);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--nexus-text, #333);
`;

function formatTimestamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

export function createHistoryPanel(options: HistoryPanelOptions): HistoryPanel {
  const root = document.createElement("aside");
  root.className = "nexus-history-panel";
  root.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  header.textContent = "History";

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;

  root.append(header, list);

  function update(): void {
    const snapshots = options.getSnapshots();
    list.textContent = "";

    if (snapshots.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent = "No snapshots yet";
      list.appendChild(empty);
      return;
    }

    for (const snapshot of snapshots) {
      const item = document.createElement("section");
      item.style.cssText = ITEM_STYLES;
      item.dataset.snapshotId = snapshot.id;

      const title = document.createElement("div");
      title.style.cssText = TITLE_STYLES;
      title.textContent = snapshot.title;
      title.title = snapshot.title;

      const meta = document.createElement("div");
      meta.style.cssText = META_STYLES;
      meta.textContent = `${snapshot.filePath ?? "Untitled"} · ${formatTimestamp(snapshot.createdAt)}`;

      const summary = document.createElement("div");
      summary.style.cssText = SUMMARY_STYLES;
      summary.textContent = snapshot.summary;

      const actions = document.createElement("div");
      actions.style.cssText = ACTION_ROW_STYLES;

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.textContent = "Restore";
      restoreBtn.style.cssText = ACTION_BTN_STYLES;
      restoreBtn.addEventListener("click", () => options.onRestore(snapshot));

      const reuseBtn = document.createElement("button");
      reuseBtn.type = "button";
      reuseBtn.textContent = "Reuse";
      reuseBtn.style.cssText = ACTION_BTN_STYLES;
      reuseBtn.addEventListener("click", () => options.onReuse(snapshot));

      actions.append(restoreBtn, reuseBtn);
      item.append(title, meta, summary, actions);
      list.appendChild(item);
    }
  }

  update();

  return {
    element: root,
    update,
    destroy() {
      root.remove();
    },
  };
}
