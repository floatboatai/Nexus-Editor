import type { MenuItemDefinition } from "@floatboat/nexus-plugin-api";
import { t } from "./i18n";

export interface VaultContextMenuRequest {
  readonly event: MouseEvent;
  readonly node: VaultNode;
  readonly items: readonly MenuItemDefinition[];
}

export interface VaultPanelSnapshot {
  readonly rootPath: string;
  readonly displayName: string;
  readonly nodes: VaultNode[];
}

/** I/O ownership boundary. Runtime mode supplies a capability-backed backend. */
export interface VaultPanelBackend {
  openVault(rootPath: string): Promise<VaultPanelSnapshot | null>;
  pickVault(): Promise<VaultPanelSnapshot | null>;
  list(rootPath: string): Promise<VaultNode[]>;
  read(filePath: string): Promise<DemoFileHandle>;
  write(filePath: string, content: string): Promise<{ path: string }>;
  createFile(parentDir: string, name: string): Promise<{ path: string }>;
  createFolder(parentDir: string, name: string): Promise<{ path: string }>;
  rename(oldPath: string, newName: string): Promise<{ path: string }>;
  trash(targetPath: string): Promise<{ ok: boolean }>;
  onChanged(callback: () => void): () => void;
}

export interface VaultPanelCallbacks {
  onOpenFile(filePath: string): void;
  onBeforeVaultOpen?(vaultPath: string): boolean | Promise<boolean>;
  onVaultOpen?(vaultPath: string): void | Promise<void>;
  onFileRenamed?(oldPath: string, newPath: string): void | Promise<void>;
  onFileDeleted?(path: string): void | Promise<void>;
  onContextMenu?(request: VaultContextMenuRequest): void | Promise<void>;
  onError(message: string): void;
  onStatus(message: string): void;
}

export interface VaultPanel {
  element: HTMLElement;
  openVault(vaultPath: string): Promise<void>;
  promptPickVault(): Promise<void>;
  refresh(): Promise<void>;
  readFile(filePath: string): Promise<DemoFileHandle>;
  writeFile(filePath: string, content: string): Promise<{ path: string }>;
  createFile(parentDir: string, name: string): Promise<{ path: string }>;
  setActiveFile(filePath: string | null): void;
  getVaultPath(): string | null;
  destroy(): void;
}

export function createLegacyVaultPanelBackend(
  bridge?: VaultBridge,
): VaultPanelBackend {
  const legacyBridge = bridge ?? window.nexusDemo?.vault;
  if (!legacyBridge) throw new Error("Legacy Vault bridge is unavailable in runtime mode");
  const snapshot = async (rootPath: string): Promise<VaultPanelSnapshot> => {
    const nodes = await legacyBridge.list(rootPath);
    await legacyBridge.setLast(rootPath);
    return {
      rootPath,
      displayName: rootPath.split(/[\\\\/]/).pop() || t("vault.title"),
      nodes,
    };
  };
  const backend: VaultPanelBackend = {
    openVault: snapshot,
    pickVault: async () => {
      const picked = await legacyBridge.pick();
      return picked ? snapshot(picked.path) : null;
    },
    list: (rootPath) => legacyBridge.list(rootPath),
    read: (filePath) => legacyBridge.read(filePath),
    write: (filePath, content) => legacyBridge.write(filePath, content),
    createFile: (parentDir, name) => legacyBridge.createFile(parentDir, name),
    createFolder: (parentDir, name) => legacyBridge.createFolder(parentDir, name),
    rename: (oldPath, newName) => legacyBridge.rename(oldPath, newName),
    trash: (targetPath) => legacyBridge.delete(targetPath),
    onChanged: (callback) => legacyBridge.onChanged(callback),
  };
  return Object.freeze(backend);
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

function showContextMenu(
  x: number,
  y: number,
  items: readonly MenuItemDefinition[],
): () => void {
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

  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let listening = false;
  const close = (event?: MouseEvent) => {
    if (event && menu.contains(event.target as Node)) return;
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    if (listening) document.removeEventListener("mousedown", close);
    listening = false;
    menu.remove();
  };

  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label ?? item.ariaLabel ?? item.tooltip ?? item.id;
    btn.style.cssText = `
      display: block;
      width: 100%;
      border: none;
      background: transparent;
      padding: 6px 12px;
      cursor: pointer;
      text-align: left;
      color: ${item.dangerous ? "#d73a49" : "inherit"};
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
      close();
      void item.action?.({} as never);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (!menu.isConnected) return;
    listening = true;
    document.addEventListener("mousedown", close);
  }, 0);
  return () => close();
}

function folderIcon(open: boolean): string {
  return open ? "\u25BE" : "\u25B8"; // ▾ / ▸
}

function fileIcon(): string {
  return "\u00B7"; // middle dot
}

export function createVaultPanel(
  callbacks: VaultPanelCallbacks,
  backend: VaultPanelBackend = createLegacyVaultPanelBackend(),
): VaultPanel {
  const panel = document.createElement("div");
  panel.className = "nexus-vault-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;

  const title = document.createElement("div");
  title.style.cssText = HEADER_TITLE_STYLES;
  title.textContent = t("vault.title");

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.style.cssText = ICON_BTN_STYLES;
  openBtn.textContent = "\uD83D\uDCC1"; // 📁
  openBtn.title = t("vault.openVault");

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.style.cssText = ICON_BTN_STYLES;
  newFileBtn.textContent = "\u002B"; // +
  newFileBtn.title = t("vault.newFileAtRoot");
  newFileBtn.disabled = true;

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.style.cssText = ICON_BTN_STYLES;
  newFolderBtn.textContent = "\uD83D\uDCC2"; // 📂
  newFolderBtn.title = t("vault.newFolderAtRoot");
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
  let currentTree: VaultNode[] = [];
  let activeFile: string | null = null;
  const collapsed = new Set<string>();
  let unsubscribeChanged: (() => void) | null = null;
  let closeContextMenu: (() => void) | null = null;

  function renderEmpty(message: string): void {
    tree.innerHTML = "";
    const empty = document.createElement("div");
    empty.style.cssText = EMPTY_STYLES;
    empty.textContent = message;
    tree.appendChild(empty);
  }

  function renderNode(node: VaultNode, depth: number, parent: HTMLElement): void {
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = node.path;
    row.dataset.kind = node.kind;

    const isActive = node.kind === "file" && activeFile === node.path;
    if (isActive) row.style.cssText = ITEM_BASE + ACTIVE_STYLES;

    const icon = document.createElement("span");
    icon.style.cssText = "width: 12px; flex-shrink: 0; color: #888; font-size: 11px;";
    if (node.kind === "directory") {
      const open = !collapsed.has(node.path);
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
      if (node.kind === "directory") {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        renderTree();
      } else {
        callbacks.onOpenFile(node.path);
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
      openNodeContextMenu(e, node);
    });

    if (node.kind === "directory" && !collapsed.has(node.path) && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1, parent);
      }
    }
  }

  function renderTree(): void {
    tree.innerHTML = "";
    if (!vaultPath) {
      renderEmpty(t("vault.emptyNoVault"));
      return;
    }
    if (currentTree.length === 0) {
      renderEmpty(t("vault.emptyEmptyVault"));
      return;
    }
    for (const node of currentTree) renderNode(node, 0, tree);
  }

  function beginInlineRename(row: HTMLElement, label: HTMLElement, node: VaultNode): void {
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
        const result = await backend.rename(node.path, newName);
        if (activeFile === node.path || activeFile?.startsWith(`${node.path.replace(/[\\/]+$/, "")}/`)) {
          activeFile = `${result.path}${activeFile.slice(node.path.length)}`;
        }
        await callbacks.onFileRenamed?.(node.path, result.path);
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

  function openNodeContextMenu(event: MouseEvent, node: VaultNode): void {
    const parentDir = node.kind === "directory" ? node.path : node.path.replace(/[\\/][^\\/]+$/, "");
    const items: MenuItemDefinition[] = [];

    if (node.kind === "directory") {
      items.push({
        id: "new-file",
        label: t("vault.menu.newFileHere"),
        action: () => createFilePrompt(node.path),
      });
      items.push({
        id: "new-folder",
        label: t("vault.menu.newFolderHere"),
        action: () => createFolderPrompt(node.path),
      });
    } else {
      items.push({
        id: "open",
        label: t("common.open"),
        action: () => callbacks.onOpenFile(node.path),
      });
      items.push({
        id: "new-file",
        label: t("vault.menu.newFileSameFolder"),
        action: () => createFilePrompt(parentDir),
      });
    }

    items.push({
      id: "rename",
      label: t("common.rename"),
      action: () => {
        const row = tree.querySelector<HTMLElement>(`[data-path="${cssEscape(node.path)}"]`);
        const label = row?.querySelector<HTMLElement>("span:last-child");
        if (row && label) beginInlineRename(row, label, node);
      },
    });

    items.push({
      id: "delete",
      label: t("common.delete"),
      dangerous: true,
      action: () => deleteNode(node),
    });

    closeContextMenu?.();
    closeContextMenu = null;
    if (callbacks.onContextMenu) {
      void Promise.resolve(callbacks.onContextMenu({ event, node, items })).catch((error) => {
        callbacks.onError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    closeContextMenu = showContextMenu(event.clientX, event.clientY, items);
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
        const result = await backend.createFile(parentDir, name);
        await refresh();
        callbacks.onOpenFile(result.path);
      },
    });
  }

  function createFolderPrompt(parentDir: string): void {
    inlineInputRow({
      defaultValue: "new-folder",
      selectExt: false,
      iconChar: folderIcon(true),
      onCommit: async (name) => {
        await backend.createFolder(parentDir, name);
        await refresh();
      },
    });
  }

  async function deleteNode(node: VaultNode): Promise<void> {
    // In Electron window.confirm may be a no-op; the context menu entry is
    // destructive-styled and requires an explicit click, so we proceed directly.
    try {
      await backend.trash(node.path);
      callbacks.onStatus(t("vault.movedToTrash", { name: node.name }));
      if (node.kind === "file" && activeFile === node.path) {
        activeFile = null;
      }
      await callbacks.onFileDeleted?.(node.path);
      await refresh();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(): Promise<void> {
    if (!vaultPath) return;
    try {
      currentTree = await backend.list(vaultPath);
      renderTree();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openVault(nextPath: string): Promise<void> {
    if (await callbacks.onBeforeVaultOpen?.(nextPath) === false) return;
    const next = await backend.openVault(nextPath);
    if (!next) return;
    await commitSnapshot(next);
  }

  async function commitSnapshot(next: VaultPanelSnapshot): Promise<void> {
    unsubscribeChanged?.();
    vaultPath = next.rootPath;
    currentTree = next.nodes;
    activeFile = null;
    title.textContent = next.displayName;
    title.title = next.rootPath;
    syncButtonEnabled();
    collapsed.clear();
    unsubscribeChanged = backend.onChanged(() => void refresh());
    renderTree();
    await callbacks.onVaultOpen?.(next.rootPath);
  }

  async function promptPickVault(): Promise<void> {
    try {
      if (await callbacks.onBeforeVaultOpen?.("") === false) return;
      const picked = await backend.pickVault();
      if (picked) await commitSnapshot(picked);
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
    readFile: (filePath) => backend.read(filePath),
    writeFile: (filePath, content) => backend.write(filePath, content),
    createFile: (parentDir, name) => backend.createFile(parentDir, name),
    setActiveFile(filePath) {
      activeFile = filePath;
      renderTree();
    },
    getVaultPath: () => vaultPath,
    destroy() {
      closeContextMenu?.();
      closeContextMenu = null;
      unsubscribeChanged?.();
      unsubscribeChanged = null;
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
