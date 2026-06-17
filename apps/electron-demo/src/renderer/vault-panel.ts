export interface VaultPanelCallbacks {
  onOpenFile(filePath: string): void;
  onError(message: string): void;
  onStatus(message: string): void;
  /**
   * Clears the currently opened document in the editor.
   * Used by "Delete" / "Close" actions in the vault panel so we don't touch
   * filesystem data.
   */
  onClearActiveFile?: () => void;
  /** Called after the active vault workspace is detached from the editor. */
  onVaultClosed?: () => void;
  /** Called after a vault folder is attached to the editor. */
  onVaultOpened?: (vaultPath: string) => void;
}

export interface VaultPanel {
  element: HTMLElement;
  openVault(vaultPath: string): Promise<void>;
  closeVault(): Promise<void>;
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

function normalizeFsPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathInsideVault(filePath: string, vault: string): boolean {
  const normalizedFile = normalizeFsPath(filePath);
  const normalizedVault = normalizeFsPath(vault);
  return (
    normalizedFile === normalizedVault ||
    normalizedFile.startsWith(`${normalizedVault}/`)
  );
}

function pathsEqual(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

function expandParentsToFile(nodes: VaultNode[], filePath: string): boolean {
  const target = normalizeFsPath(filePath);
  for (const node of nodes) {
    if (node.kind === "file") {
      if (normalizeFsPath(node.path) === target) {
        return true;
      }
      continue;
    }
    if (node.children && expandParentsToFile(node.children, filePath)) {
      collapsed.delete(node.path);
      return true;
    }
  }
  return false;
}

function scrollActiveRowIntoView(tree: HTMLElement, filePath: string): void {
  const target = normalizeFsPath(filePath);
  for (const row of tree.querySelectorAll<HTMLElement>("[data-path]")) {
    const path = row.dataset.path;
    if (path && normalizeFsPath(path) === target) {
      row.scrollIntoView({ block: "nearest" });
      break;
    }
  }
}

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
  newFileBtn.title = "New file";

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.style.cssText = ICON_BTN_STYLES;
  newFolderBtn.textContent = "\uD83D\uDCC2"; // 📂
  newFolderBtn.title = "New folder at root";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.style.cssText = ICON_BTN_STYLES;
  closeBtn.textContent = "\u00D7"; // ×
  closeBtn.title = "Close vault";
  closeBtn.disabled = true;

  header.append(title, newFileBtn, newFolderBtn, closeBtn, openBtn);
  attachIconBtnFeedback(openBtn);
  attachIconBtnFeedback(newFileBtn);
  attachIconBtnFeedback(newFolderBtn);
  attachIconBtnFeedback(closeBtn);

  function syncButtonEnabled(): void {
    const hasVault = vaultPath !== null;
    closeBtn.disabled = !hasVault;
    closeBtn.style.opacity = hasVault ? "1" : "0.4";
    closeBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
  }

  const tree = document.createElement("div");
  tree.style.cssText = TREE_STYLES;

  panel.append(header, tree);

  let vaultPath: string | null = null;
  let currentTree: VaultNode[] = [];
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

  function renderNode(node: VaultNode, depth: number, parent: HTMLElement): void {
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = node.path;
    row.dataset.kind = node.kind;

    const isActive = node.kind === "file" && activeFile !== null && pathsEqual(activeFile, node.path);
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
      openNodeContextMenu(e.clientX, e.clientY, node);
    });

    if (node.kind === "directory" && !collapsed.has(node.path) && node.children) {
      for (const child of node.children) {
        renderNode(child, depth + 1, parent);
      }
    }
  }

  function renderExternalFile(filePath: string): void {
    const heading = document.createElement("div");
    heading.style.cssText =
      "padding: 6px 10px 2px; font-size: 10px; font-weight: 600; letter-spacing: 0.4px;" +
      "text-transform: uppercase; color: var(--nexus-text-muted, #888);";
    heading.textContent = "Open file";

    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE + ACTIVE_STYLES;
    row.style.paddingLeft = "8px";
    row.dataset.path = filePath;
    row.dataset.kind = "file";
    row.title = filePath;

    const icon = document.createElement("span");
    icon.style.cssText = "width: 12px; flex-shrink: 0; color: #888; font-size: 11px;";
    icon.textContent = fileIcon();

    const label = document.createElement("span");
    label.textContent = filePath.split(/[\\/]/).pop() || filePath;
    label.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";

    row.append(icon, label);
    row.addEventListener("click", () => callbacks.onOpenFile(filePath));

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "×";
    clearBtn.title = "Remove from editor";
    clearBtn.style.cssText =
      "border:none;background:transparent;cursor:pointer;padding:0 4px;color:var(--nexus-text-muted,#888);font-size:16px;line-height:1;flex-shrink:0;";
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onClearActiveFile?.();
      activeFile = null;
      renderTree();
    });
    row.appendChild(clearBtn);

    tree.append(heading, row);
  }

  function renderTree(): void {
    tree.innerHTML = "";
    if (!vaultPath) {
      if (activeFile) {
        renderExternalFile(activeFile);
        return;
      }
      renderEmpty("No vault opened. Click 📁 to choose a folder, or + to create a file.");
      return;
    }

    if (activeFile && !isPathInsideVault(activeFile, vaultPath)) {
      renderExternalFile(activeFile);
      const sep = document.createElement("div");
      sep.style.cssText = "height: 1px; margin: 4px 8px; background: var(--nexus-border, #eee);";
      tree.appendChild(sep);
    }

    if (currentTree.length === 0) {
      renderEmpty("Vault is empty. Click + to create a note.");
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
        await window.nexusDemo.vault.rename(node.path, newName);
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

  function openNodeContextMenu(x: number, y: number, node: VaultNode): void {
    const parentDir = node.kind === "directory" ? node.path : node.path.replace(/[\\/][^\\/]+$/, "");
    const items: ContextMenuItem[] = [];

    if (node.kind === "directory") {
      items.push({
        label: "New file here",
        onClick: () => createFilePrompt(node.path),
      });
      items.push({
        label: "New folder here",
        onClick: () => createFolderPrompt(node.path),
      });
    } else {
      items.push({
        label: "Open",
        onClick: () => callbacks.onOpenFile(node.path),
      });
      items.push({
        label: "New file in same folder",
        onClick: () => createFilePrompt(parentDir),
      });
    }

    items.push({
      label: "Rename",
      onClick: () => {
        const row = tree.querySelector<HTMLElement>(`[data-path="${cssEscape(node.path)}"]`);
        const label = row?.querySelector<HTMLElement>("span:last-child");
        if (row && label) beginInlineRename(row, label, node);
      },
    });

    items.push({
      label: "Clear in editor",
      destructive: false,
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
        const result = await window.nexusDemo.vault.createFile(parentDir, name);
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
        await window.nexusDemo.vault.createFolder(parentDir, name);
        await refresh();
      },
    });
  }

  async function deleteNode(node: VaultNode): Promise<void> {
    // "Delete" in the vault panel should not remove filesystem data.
    // Instead, we only clear the currently opened document in the editor.
    try {
      if (node.kind === "file") {
        const isActive = activeFile && pathsEqual(activeFile, node.path);
        if (!isActive) {
          callbacks.onStatus("Open the file first to clear it from the editor.");
          return;
        }
        callbacks.onClearActiveFile?.();
        activeFile = null;
        renderTree();
        return;
      }

      // Directory delete: if the current active file is inside that directory, clear it.
      if (activeFile) {
        const dir = normalizeFsPath(node.path);
        const file = normalizeFsPath(activeFile);
        if (file === dir || file.startsWith(`${dir}/`)) {
          callbacks.onClearActiveFile?.();
          activeFile = null;
          renderTree();
          return;
        }
      }
      callbacks.onStatus("This action only clears the editor for the currently opened file.");
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(): Promise<void> {
    if (!vaultPath) return;
    try {
      currentTree = await window.nexusDemo.vault.list(vaultPath);
      renderTree();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function closeVault(): Promise<void> {
    if (!vaultPath) return;

    if (unsubscribeChanged) {
      unsubscribeChanged();
      unsubscribeChanged = null;
    }

    await window.nexusDemo.vault.close();

    vaultPath = null;
    currentTree = [];
    collapsed.clear();
    title.textContent = "Vault";
    title.title = "";
    syncButtonEnabled();
    renderTree();
    callbacks.onVaultClosed?.();
  }

  async function ensureVault(): Promise<string | null> {
    if (vaultPath) return vaultPath;
    try {
      const picked = await window.nexusDemo.vault.pick();
      if (!picked) return null;
      await openVault(picked.path);
      return vaultPath;
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function openVault(nextPath: string): Promise<void> {
    vaultPath = nextPath;
    title.textContent = nextPath.split(/[\\/]/).pop() || "Vault";
    title.title = nextPath;
    syncButtonEnabled();
    collapsed.clear();

    if (unsubscribeChanged) unsubscribeChanged();
    unsubscribeChanged = window.nexusDemo.vault.onChanged(() => {
      void refresh();
    });

    await refresh();
    await window.nexusDemo.vault.setLast(nextPath);
    callbacks.onVaultOpened?.(nextPath);
  }

  async function promptPickVault(): Promise<void> {
    try {
      const picked = await window.nexusDemo.vault.pick();
      if (!picked) return;
      await openVault(picked.path);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  closeBtn.addEventListener("click", () => {
    void closeVault();
  });
  openBtn.addEventListener("click", () => {
    void promptPickVault();
  });
  newFileBtn.addEventListener("click", () => {
    void (async () => {
      const root = await ensureVault();
      if (root) createFilePrompt(root);
    })();
  });
  newFolderBtn.addEventListener("click", () => {
    void (async () => {
      const root = await ensureVault();
      if (root) createFolderPrompt(root);
    })();
  });

  syncButtonEnabled();

  return {
    element: panel,
    openVault,
    closeVault,
    promptPickVault,
    refresh,
    setActiveFile(filePath) {
      activeFile = filePath;
      if (filePath && vaultPath && isPathInsideVault(filePath, vaultPath)) {
        expandParentsToFile(currentTree, filePath);
      }
      renderTree();
      if (filePath) {
        requestAnimationFrame(() => scrollActiveRowIntoView(tree, filePath));
      }
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
