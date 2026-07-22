import { i18n } from "./i18n";

export interface VaultPanelCallbacks {
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

/** Vertical spacing between tree nodes. */
const CHILDREN_CONTAINER_STYLES = `
  overflow: hidden;
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
  return open ? "\u{1F4C2}" : "\u{1F4C1}"; // 📂 / 📁
}

function fileIcon(): string {
  return "\u{1F4C4}"; // 📄
}

/** Depth → px of left padding for tree rows. */
function indentPx(depth: number): number {
  return 8 + depth * 16;
}

export function createVaultPanel(callbacks: VaultPanelCallbacks): VaultPanel {
  const panel = document.createElement("div");
  panel.className = "nexus-vault-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;

  const title = document.createElement("div");
  title.style.cssText = HEADER_TITLE_STYLES;
  title.textContent = i18n.t("vault.title");

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.style.cssText = ICON_BTN_STYLES;
  openBtn.textContent = "\u{1F4C1}"; // 📁
  openBtn.title = i18n.t("vault.openBtnTitle");

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.style.cssText = ICON_BTN_STYLES;
  newFileBtn.textContent = "+"; // +
  newFileBtn.title = i18n.t("vault.openBtn.title");
  newFileBtn.disabled = true;

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.style.cssText = ICON_BTN_STYLES;
  newFolderBtn.textContent = "\u{1F4C2}"; // 📂
  newFolderBtn.title = i18n.t("vault.newFolderBtn.title");
  newFolderBtn.disabled = true;

  const collapseAllBtn = document.createElement("button");
  collapseAllBtn.type = "button";
  collapseAllBtn.style.cssText = ICON_BTN_STYLES;
  collapseAllBtn.textContent = "▼"; // ▼
  collapseAllBtn.title = i18n.t("vault.collapseAllFolders");
  collapseAllBtn.disabled = true;

  const expandAllBtn = document.createElement("button");
  expandAllBtn.type = "button";
  expandAllBtn.style.cssText = ICON_BTN_STYLES;
  expandAllBtn.textContent = "▶"; // ▶
  expandAllBtn.title = i18n.t("vault.expandAllFolders");
  expandAllBtn.disabled = true;

  header.append(title, newFileBtn, newFolderBtn, collapseAllBtn, expandAllBtn, openBtn);
  attachIconBtnFeedback(openBtn);
  attachIconBtnFeedback(newFileBtn);
  attachIconBtnFeedback(newFolderBtn);
  attachIconBtnFeedback(collapseAllBtn);
  attachIconBtnFeedback(expandAllBtn);

  function syncButtonEnabled(): void {
    const hasVault = vaultPath !== null;
    newFileBtn.disabled = !hasVault;
    newFolderBtn.disabled = !hasVault;
    collapseAllBtn.disabled = !hasVault;
    expandAllBtn.disabled = !hasVault;
    newFileBtn.style.opacity = hasVault ? "1" : "0.4";
    newFolderBtn.style.opacity = hasVault ? "1" : "0.4";
    collapseAllBtn.style.opacity = hasVault ? "1" : "0.4";
    expandAllBtn.style.opacity = hasVault ? "1" : "0.4";
    newFileBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
    newFolderBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
    collapseAllBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
    expandAllBtn.style.cursor = hasVault ? "pointer" : "not-allowed";
  }

  const tree = document.createElement("div");
  tree.style.cssText = TREE_STYLES;

  // Root-level drop target (move to vault root) — added once
  tree.addEventListener("dragover", (e) => {
    if (!_dragSrcPath) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = "move";
  });
  tree.addEventListener("drop", (e) => {
    if (!_dragSrcPath) return;
    e.preventDefault();
    if (vaultPath) void handleMove(_dragSrcPath, vaultPath);
  });

  panel.append(header, tree);

  let vaultPath: string | null = null;
  let currentTree: VaultNode[] = [];
  let activeFile: string | null = null;
  const collapsed = new Set<string>();
  let unsubscribeChanged: (() => void) | null = null;
  let _dragSrcPath: string | null = null;
  let _dragSrcIsDir = false;

  function renderEmpty(message: string): void {
    tree.innerHTML = "";
    const empty = document.createElement("div");
    empty.style.cssText = EMPTY_STYLES;
    empty.textContent = message;
    tree.appendChild(empty);
  }

  /**
   * Recursively collect every directory path in the tree so we can
   * collapse / expand all at once.
   */
  function collectAllDirs(nodes: VaultNode[], acc: string[]): void {
    for (const node of nodes) {
      if (node.kind === "directory") {
        acc.push(node.path);
        if (node.children) collectAllDirs(node.children, acc);
      }
    }
  }

  /**
   * Collapse every directory, then re-render.
   */
  function collapseAll(): void {
    const dirs: string[] = [];
    collectAllDirs(currentTree, dirs);
    for (const d of dirs) collapsed.add(d);
    renderTree();
  }

  /**
   * Expand every directory, then re-render.
   */
  function expandAll(): void {
    const dirs: string[] = [];
    collectAllDirs(currentTree, dirs);
    for (const d of dirs) collapsed.delete(d);
    renderTree();
  }

  /**
   * Render a single vault node (file or directory).
   *
   * Directory children are wrapped in a `nexus-vault-children` container
   * so expand / collapse can toggle visibility without a full re-render.
   */
  function renderNode(node: VaultNode, depth: number, parent: HTMLElement): HTMLElement {
    const pad = indentPx(depth);
    const isDir = node.kind === "directory";
    const isActive = !isDir && activeFile === node.path;
    const dirOpen = !collapsed.has(node.path);

    // --- row ---
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE + "outline: none;";
    row.style.paddingLeft = `${pad}px`;
    row.dataset.path = node.path;
    row.dataset.kind = node.kind;
    row.tabIndex = 0;

    if (isActive) {
      row.style.cssText = ITEM_BASE + ACTIVE_STYLES + "outline: none;";
      row.style.paddingLeft = `${pad}px`; // re-apply after cssText reset
    }

    const icon = document.createElement("span");
    icon.style.cssText = "width: 16px; flex-shrink: 0; font-size: 13px; text-align: center;";
    if (isDir) {
      icon.textContent = folderIcon(dirOpen);
    } else {
      icon.textContent = fileIcon();
    }

    const label = document.createElement("span");
    label.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";

    if (isDir) {
      // Show folder name in boldish style to visually separate from files.
      label.textContent = node.name;
      label.style.fontWeight = "500";
    } else {
      label.textContent = node.name;
    }

    // For empty directories show a subtle hint.
    if (isDir && (!node.children || node.children.length === 0)) {
      const hint = document.createElement("span");
      hint.textContent = i18n.t("vault.emptyHint");
      hint.style.cssText = "color: var(--nexus-text-faint, #bbb); font-size: 11px; font-style: italic; font-weight: 400;";
      label.appendChild(hint);
    }

    row.append(icon, label);
    parent.appendChild(row);

    // --- hover (dynamically checks activeFile so in-place style updates work) ---
    row.addEventListener("mouseenter", () => {
      if (activeFile !== node.path) row.style.background = "var(--nexus-bg-muted, #f4f4f4)";
    });
    row.addEventListener("mouseleave", () => {
      if (activeFile !== node.path) row.style.background = "transparent";
    });

    // --- focus indicator ---
    row.addEventListener("focus", () => {
      row.style.boxShadow = "inset 0 0 0 2px var(--nexus-accent, #7c6cf4)";
    });
    row.addEventListener("blur", () => {
      row.style.boxShadow = "";
    });

    // --- click ---
    row.addEventListener("click", () => {
      row.focus();
      if (isDir) {
        // Toggle in-place — no full re-render needed.
        const container = row.nextElementSibling as HTMLElement | null;
        if (collapsed.has(node.path)) {
          collapsed.delete(node.path);
          icon.textContent = folderIcon(true);
          if (container && container.classList.contains("nexus-vault-children")) {
            container.style.display = "";
          }
        } else {
          collapsed.add(node.path);
          icon.textContent = folderIcon(false);
          if (container && container.classList.contains("nexus-vault-children")) {
            container.style.display = "none";
          }
        }
      } else if (!isActive) {
        callbacks.onOpenFile(node.path);
      }
    });

    // --- drag-and-drop (only directories accept drops) ---
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      _dragSrcPath = node.path;
      _dragSrcIsDir = isDir;
      row.style.opacity = "0.5";
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", node.path);
    });
    row.addEventListener("dragend", () => {
      _dragSrcPath = null;
      row.style.opacity = "";
      // Clear any drag-over highlights left by other items
      tree.querySelectorAll(".nexus-vault-dragover").forEach((el) => {
        (el as HTMLElement).style.background = "";
        el.classList.remove("nexus-vault-dragover");
      });
    });

    if (isDir) {
      row.addEventListener("dragover", (e) => {
        if (!_dragSrcPath || _dragSrcPath === node.path) return;
        // Prevent dropping a folder into itself or a descendant
        if (_dragSrcIsDir && node.path.startsWith(_dragSrcPath + "/")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer!.dropEffect = "move";
        row.classList.add("nexus-vault-dragover");
        row.style.background = "var(--nexus-bg-muted, #e8f0ff)";
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("nexus-vault-dragover");
        row.style.background = "";
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove("nexus-vault-dragover");
        row.style.background = "";
        if (!_dragSrcPath || _dragSrcPath === node.path) return;
        if (_dragSrcIsDir && node.path.startsWith(_dragSrcPath + "/")) return;
        void handleMove(_dragSrcPath, node.path);
      });
    }

    // --- keyboard: Enter to rename ---
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        beginInlineRename(row, label, node);
      }
    });

    // --- dblclick rename ---
    row.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      beginInlineRename(row, label, node);
    });

    // --- context menu ---
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNodeContextMenu(e.clientX, e.clientY, node);
    });

    // --- children container ---
    if (isDir && node.children) {
      const container = document.createElement("div");
      container.className = "nexus-vault-children";
      container.style.cssText = CHILDREN_CONTAINER_STYLES;
      if (!dirOpen) container.style.display = "none";
      for (const child of node.children) {
        renderNode(child, depth + 1, container);
      }
      parent.appendChild(container);
    }

    return row;
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
        label: i18n.t("vault.context.newFileHere"),
        onClick: () => createFilePrompt(node.path),
      });
      items.push({
        label: i18n.t("vault.context.newFolderHere"),
        onClick: () => createFolderPrompt(node.path),
      });
    } else {
      items.push({
        label: i18n.t("vault.context.open"),
        onClick: () => callbacks.onOpenFile(node.path),
      });
      items.push({
        label: i18n.t("vault.context.newFileSameFolder"),
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
    parentDir?: string | null;
    onCommit: (value: string) => Promise<void>;
  }): void {
    const row = document.createElement("div");
    row.style.cssText = ITEM_BASE;

    const icon = document.createElement("span");
    icon.style.cssText = "width: 16px; flex-shrink: 0; font-size: 13px; text-align: center;";
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

    // Determine insertion position and indentation depth
    let depth = 0;
    let inserted = false;

    if (opts.parentDir && vaultPath && opts.parentDir !== vaultPath) {
      const parentRow = tree.querySelector<HTMLElement>(
        `[data-path="${cssEscape(opts.parentDir)}"]`
      );
      if (parentRow) {
        const parentPadding = parseInt(parentRow.style.paddingLeft || "8") || 8;
        depth = Math.round((parentPadding - 8) / 16) + 1;

        const next = parentRow.nextElementSibling;
        const childrenContainer =
          next && next.classList.contains("nexus-vault-children")
            ? (next as HTMLElement)
            : null;

        if (childrenContainer) {
          childrenContainer.insertBefore(row, childrenContainer.firstChild);
          // Ensure parent is expanded
          collapsed.delete(opts.parentDir);
          childrenContainer.style.display = "";
          const iconEl = parentRow.querySelector("span:first-child");
          if (iconEl) iconEl.textContent = folderIcon(true);
        } else {
          // Create children container for an empty directory
          const container = document.createElement("div");
          container.className = "nexus-vault-children";
          container.style.cssText = CHILDREN_CONTAINER_STYLES;
          container.appendChild(row);
          parentRow.after(container);
        }
        inserted = true;
      }
    }

    if (!inserted) {
      tree.insertBefore(row, tree.firstChild);
    }

    row.style.paddingLeft = `${indentPx(depth)}px`;
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
    // Only commit on Enter — blur cancels without creating
    input.addEventListener("blur", () => {
      void finish(false);
    });
  }

  function createFilePrompt(parentDir: string): void {
    inlineInputRow({
      defaultValue: "untitled.md",
      selectExt: true,
      iconChar: fileIcon(),
      parentDir,
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
      parentDir,
      onCommit: async (name) => {
        await window.nexusDemo.vault.createFolder(parentDir, name);
        await refresh();
      },
    });
  }



  async function handleMove(sourcePath: string, destDir: string): Promise<void> {
    try {
      await window.nexusDemo.vault.move(sourcePath, destDir);
      await refresh();
      callbacks.onStatus(i18n.t("vault.status.moved", { name: sourcePath.split(/[\\/]/).pop()!, dest: destDir.split(/[\\/]/).pop()!}));
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteNode(node: VaultNode): Promise<void> {
    try {
      await window.nexusDemo.vault.delete(node.path);
      callbacks.onStatus(i18n.t("vault.status.deleted", { name: node.name }));
      if (node.kind === "file" && activeFile === node.path) {
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
      currentTree = await window.nexusDemo.vault.list(vaultPath);
      renderTree();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openVault(nextPath: string): Promise<void> {
    vaultPath = nextPath;
    title.textContent = nextPath.split(/[\\/]/).pop()! || i18n.t("vault.title");
    title.title = nextPath;
    syncButtonEnabled();
    collapsed.clear();

    if (unsubscribeChanged) unsubscribeChanged();
    unsubscribeChanged = window.nexusDemo.vault.onChanged(() => {
      void refresh();
    });

    await refresh();
    await window.nexusDemo.vault.setLast(nextPath);
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

  openBtn.addEventListener("click", () => {
    void promptPickVault();
  });
  newFileBtn.addEventListener("click", () => {
    if (vaultPath) createFilePrompt(vaultPath);
  });
  newFolderBtn.addEventListener("click", () => {
    if (vaultPath) createFolderPrompt(vaultPath);
  });
  collapseAllBtn.addEventListener("click", () => {
    if (vaultPath) collapseAll();
  });
  expandAllBtn.addEventListener("click", () => {
    if (vaultPath) expandAll();
  });

  syncButtonEnabled();

  return {
    element: panel,
    openVault,
    promptPickVault,
    refresh,
    setActiveFile(filePath) {
      // In-place CSS update — avoids destroying the DOM (and thus losing
      // keyboard focus) on every file switch.  Only update if the value
      // actually changed so repeated calls for the same file are no-ops.
      if (activeFile === filePath) return;
      const prev = activeFile;
      activeFile = filePath;
      if (prev) {
        const prevRow = tree.querySelector<HTMLElement>(
          `[data-path="${cssEscape(prev)}"]`,
        );
        if (prevRow) {
          const depth = parseInt(prevRow.style.paddingLeft || "8") || 8;
          prevRow.style.cssText = ITEM_BASE + "outline: none;";
          prevRow.style.paddingLeft = `${depth}px`;
        }
      }
      if (filePath) {
        const nextRow = tree.querySelector<HTMLElement>(
          `[data-path="${cssEscape(filePath)}"]`,
        );
        if (nextRow) {
          const depth = parseInt(nextRow.style.paddingLeft || "8") || 8;
          nextRow.style.cssText = ITEM_BASE + ACTIVE_STYLES + "outline: none;";
          nextRow.style.paddingLeft = `${depth}px`;
        }
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
