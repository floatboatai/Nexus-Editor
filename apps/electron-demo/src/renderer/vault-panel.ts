import type { NoteVaultNode } from "@floatboat/nexus-core";
import type { ElectronVaultAdapter } from "./vault-adapter";

export interface VaultPanelCallbacks {
  adapter: ElectronVaultAdapter;
  onOpenFile(filePath: string): void;
  onError(message: string): void;
  onStatus(message: string): void;
}

export interface VaultPanel {
  element: HTMLElement;
  openVault(vaultPath: string): Promise<void>;
  promptPickVault(): Promise<void>;
  refresh(): Promise<void>;
  setActiveFile(filePath: string | null): void;
  getVaultPath(): string | null;
  destroy(): void;
}

const PANEL_STYLES = `
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
`;

const HEADER_STYLES = `
  padding: 8px 10px;
  border-bottom: 1px solid var(--nexus-border, #eee);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const HEADER_TITLE_STYLES = `
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const ICON_BTN_STYLES = `
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 3px 7px;
  font-size: 14px;
  line-height: 1;
  color: var(--nexus-text-muted, #555);
  border-radius: 3px;
  transition: background 0.12s;
`;

function attachIconBtnFeedback(btn: HTMLButtonElement): void {
  btn.addEventListener("mouseenter", () => {
    if (!btn.disabled) btn.style.background = "var(--nexus-bg-muted, #eef)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "transparent";
  });
}

const TREE_STYLES = `
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
`;

const EMPTY_STYLES = `
  padding: 16px 12px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 12px;
  font-style: italic;
  text-align: center;
`;

const ITEM_BASE = `
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 3px 8px;
  color: var(--nexus-text, #24292e);
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  user-select: none;
`;

const ACTIVE_STYLES = `
  background: var(--nexus-bg-active, #e7f0ff);
  color: var(--nexus-text, #0366d6);
`;

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  document.querySelectorAll(".nexus-vault-ctxmenu").forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = "nexus-vault-ctxmenu";
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: var(--nexus-bg, #fff);
    border: 1px solid var(--nexus-border, #ddd);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    padding: 4px 0;
    z-index: 10000;
    min-width: 160px;
    font-size: 13px;
  `;

  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.style.cssText = `
      display: block;
      width: 100%;
      border: none;
      background: transparent;
      padding: 6px 12px;
      cursor: pointer;
      text-align: left;
      color: ${item.destructive ? "#d73a49" : "inherit"};
      font-size: 13px;
      font-family: inherit;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "var(--nexus-bg-muted, #f0f0f0)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
    });
    btn.addEventListener("click", () => {
      menu.remove();
      item.onClick();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    document.addEventListener("mousedown", close);
  }, 0);
}

function folderIcon(open: boolean): string {
  return open ? "\u25BE" : "\u25B8"; // ▾ / ▸
}

function fileIcon(): string {
  return "\u00B7"; // middle dot
}

export function createVaultPanel(callbacks: VaultPanelCallbacks): VaultPanel {
  const adapter = callbacks.adapter;
  const panel = document.createElement("div");
  panel.className = "nexus-vault-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;

  const title = document.createElement("div");
  title.style.cssText = HEADER_TITLE_STYLES;
  title.textContent = "Vault";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.style.cssText = ICON_BTN_STYLES;
  openBtn.textContent = "\uD83D\uDCC1"; // 📁
  openBtn.title = "Open vault…";

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.style.cssText = ICON_BTN_STYLES;
  newFileBtn.textContent = "\u002B"; // +
  newFileBtn.title = "New file at root";
  newFileBtn.disabled = true;

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.style.cssText = ICON_BTN_STYLES;
  newFolderBtn.textContent = "\uD83D\uDCC2"; // 📂
  newFolderBtn.title = "New folder at root";
  newFolderBtn.disabled = true;

  header.append(title, newFileBtn, newFolderBtn, openBtn);
  attachIconBtnFeedback(openBtn);
  attachIconBtnFeedback(newFileBtn);
  attachIconBtnFeedback(newFolderBtn);

  function syncButtonEnabled(): void {
    const hasVault = vaultPath !== null;
    newFileBtn.disabled = !hasVault;
    newFolderBtn.disabled = !hasVault;
    newFileBtn.style.opacity = hasVault ? "1" : "0.4";
    newFolderBtn.style.opacity = hasVault ? "1" : "0.4";
    newFileBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
    newFolderBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
  }

  const tree = document.createElement("div");
  tree.style.cssText = TREE_STYLES;

  panel.append(header, tree);

  let vaultPath: string | null = null;
  let currentTree: NoteVaultNode[] = [];
  let activeFile: string | null = null;
  const collapsed = new Set<string>();
  let unsubscribeChanged: (() => void) | null = null;

  function renderEmpty(message: string): void {
    tree.innerHTML = "";
    const empty = document.createElement("div");
    empty.style.cssText = EMPTY_STYLES;
    empty.textContent = message;
    tree.appendChild(empty);
  }

  function renderNode(node: NoteVaultNode, depth: number, parent: HTMLElement): void {
    const nodePath = adapter.refToPath(node.ref);
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = nodePath;
    row.dataset.kind = node.kind;

    const isActive = node.kind === "file" && activeFile === nodePath;
    if (isActive) row.style.cssText = ITEM_BASE + ACTIVE_STYLES;

    const icon = document.createElement("span");
    icon.style.cssText = "width: 12px; flex-shrink: 0; color: #888; font-size: 11px;";
    if (node.kind === "folder") {
      const open = !collapsed.has(nodePath);
      icon.textContent = folderIcon(open);
    } else {
      icon.textContent = fileIcon();
    }

    const label = document.createElement("span");
    label.textContent = node.name;
    label.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";

    row.append(icon, label);
    parent.appendChild(row);

    row.addEventListener("mouseenter", () => {
      if (!isActive) row.style.background = "var(--nexus-bg-muted, #f4f4f4)";
    });
    row.addEventListener("mouseleave", () => {
      if (!isActive) row.style.background = "transparent";
    });

    row.addEventListener("click", () => {
      if (node.kind === "folder") {
        if (collapsed.has(nodePath)) collapsed.delete(nodePath);
        else collapsed.add(nodePath);
        renderTree();
      } else {
        callbacks.onOpenFile(nodePath);
      }
    });

    row.addEventListener("dblclick", (e) => {
      if (node.kind !== "file") return;
      e.stopPropagation();
      beginInlineRename(row, label, node);
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNodeContextMenu(e.clientX, e.clientY, node);
    });

    if (node.kind === "folder" && !collapsed.has(nodePath) && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1, parent);
      }
    }
  }

  function renderTree(): void {
    tree.innerHTML = "";
    if (!vaultPath) {
      renderEmpty("No vault opened. Click 📁 to choose a folder.");
      return;
    }
    if (currentTree.length === 0) {
      renderEmpty("Vault is empty. Click + to create a note.");
      return;
    }
    for (const node of currentTree) renderNode(node, 0, tree);
  }

  function beginInlineRename(row: HTMLElement, label: HTMLElement, node: NoteVaultNode): void {
    const input = document.createElement("input");
    input.type = "text";
    input.value = node.name;
    input.style.cssText = `
      flex: 1;
      border: 1px solid var(--nexus-accent, #0366d6);
      padding: 1px 4px;
      font-size: 13px;
      font-family: inherit;
      background: var(--nexus-bg, #fff);
      color: inherit;
    `;
    label.replaceWith(input);
    input.focus();

    const dot = node.name.lastIndexOf(".");
    if (node.kind === "file" && dot > 0) input.setSelectionRange(0, dot);
    else input.select();

    let finished = false;
    const finish = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      const newName = input.value.trim();
      if (!commit || !newName || newName === node.name) {
        input.replaceWith(label);
        return;
      }
      try {
        await adapter.rename(node.ref, newName);
        await refresh();
      } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : String(err));
        input.replaceWith(label);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function openNodeContextMenu(x: number, y: number, node: NoteVaultNode): void {
    const nodePath = adapter.refToPath(node.ref);
    const parentDir = node.kind === "folder" ? nodePath : nodePath.replace(/[\\/][^\\/]+$/, "");
    const items: ContextMenuItem[] = [];

    if (node.kind === "folder") {
      items.push({
        label: "New file here",
        onClick: () => createFilePrompt(nodePath),
      });
      items.push({
        label: "New folder here",
        onClick: () => createFolderPrompt(nodePath),
      });
    } else {
      items.push({
        label: "Open",
        onClick: () => callbacks.onOpenFile(nodePath),
      });
      items.push({
        label: "New file in same folder",
        onClick: () => createFilePrompt(parentDir),
      });
    }

    items.push({
      label: "Rename",
      onClick: () => {
        const row = tree.querySelector<HTMLElement>(`[data-path="${cssEscape(nodePath)}"]`);
        const label = row?.querySelector<HTMLElement>("span:last-child");
        if (row && label) beginInlineRename(row, label, node);
      },
    });

    items.push({
      label: "Delete",
      destructive: true,
      onClick: () => deleteNode(node),
    });

    showContextMenu(x, y, items);
  }

  function inlineInputRow(opts: {
    defaultValue: string;
    selectExt: boolean;
    iconChar: string;
    onCommit: (value: string) => Promise<void>;
  }): void {
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE;
    row.style.paddingLeft = "8px";

    const icon = document.createElement("span");
    icon.style.cssText = "width: 12px; flex-shrink: 0; color: #888; font-size: 11px;";
    icon.textContent = opts.iconChar;

    const input = document.createElement("input");
    input.type = "text";
    input.value = opts.defaultValue;
    input.style.cssText = `
      flex: 1;
      border: 1px solid var(--nexus-accent, #0366d6);
      padding: 1px 4px;
      font-size: 13px;
      font-family: inherit;
      background: var(--nexus-bg, #fff);
      color: inherit;
    `;

    row.append(icon, input);
    tree.insertBefore(row, tree.firstChild);
    input.focus();

    const dot = opts.defaultValue.lastIndexOf(".");
    if (opts.selectExt && dot > 0) input.setSelectionRange(0, dot);
    else input.select();

    let finished = false;
    const finish = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      row.remove();
      if (!commit || !value) return;
      try {
        await opts.onCommit(value);
      } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => {
      void finish(true);
    });
  }

  function createFilePrompt(parentDir: string): void {
    inlineInputRow({
      defaultValue: "untitled.md",
      selectExt: true,
      iconChar: fileIcon(),
      onCommit: async (name) => {
        const result = await adapter.createFile(adapter.pathToFolderRef(parentDir), name);
        await refresh();
        callbacks.onOpenFile(adapter.refToPath(result));
      },
    });
  }

  function createFolderPrompt(parentDir: string): void {
    inlineInputRow({
      defaultValue: "new-folder",
      selectExt: false,
      iconChar: folderIcon(true),
      onCommit: async (name) => {
        await adapter.createFolder(adapter.pathToFolderRef(parentDir), name);
        await refresh();
      },
    });
  }

  async function deleteNode(node: NoteVaultNode): Promise<void> {
    const nodePath = adapter.refToPath(node.ref);
    // In Electron window.confirm may be a no-op; the context menu entry is
    // destructive-styled and requires an explicit click, so we proceed directly.
    try {
      await adapter.delete(node.ref, { trash: true });
      callbacks.onStatus(`Moved ${node.name} to Trash`);
      if (node.kind === "file" && activeFile === nodePath) {
        activeFile = null;
      }
      await refresh();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(): Promise<void> {
    if (!vaultPath) return;
    try {
      currentTree = await adapter.list({ root: adapter.rootRef(vaultPath) });
      renderTree();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openVault(nextPath: string): Promise<void> {
    vaultPath = nextPath;
    title.textContent = nextPath.split(/[\\/]/).pop() || "Vault";
    title.title = nextPath;
    syncButtonEnabled();
    collapsed.clear();

    if (unsubscribeChanged) unsubscribeChanged();
    unsubscribeChanged = adapter.watch?.(() => {
      void refresh();
    }) ?? null;

    await refresh();
    await adapter.setLast(nextPath);
  }

  async function promptPickVault(): Promise<void> {
    try {
      const picked = await adapter.pick();
      if (!picked) return;
      await openVault(picked.path);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  openBtn.addEventListener("click", () => {
    void promptPickVault();
  });
  newFileBtn.addEventListener("click", () => {
    if (vaultPath) createFilePrompt(vaultPath);
  });
  newFolderBtn.addEventListener("click", () => {
    if (vaultPath) createFolderPrompt(vaultPath);
  });

  syncButtonEnabled();

  return {
    element: panel,
    openVault,
    promptPickVault,
    refresh,
    setActiveFile(filePath) {
      activeFile = filePath;
      renderTree();
    },
    getVaultPath: () => vaultPath,
    destroy() {
      if (unsubscribeChanged) unsubscribeChanged();
      panel.remove();
    },
  };
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
