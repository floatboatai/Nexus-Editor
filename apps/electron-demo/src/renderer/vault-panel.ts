import { iconEl } from "./icons";

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
  /** Collapse/expand the sidebar (width → 0 or restored). */
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
  destroy(): void;
}

const SIDEBAR_WIDTH_KEY = "nexus-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_COLLAPSE_THRESHOLD = 100;
const SIDEBAR_MAX_WIDTH = 480;

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  document.querySelectorAll(".nexus-vault-ctxmenu").forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = "nx-menu nexus-vault-ctxmenu";
  menu.style.position = "fixed";
  menu.style.zIndex = "10020";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nx-menu__item";
    btn.textContent = item.label;
    if (item.destructive) btn.style.color = "var(--ds-semantic-error, #dc2626)";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      item.onClick();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // Keep menu inside viewport.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight - 8) {
    menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
  }

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
  panel.className = "nx-sidebar nexus-vault-panel";

  let storedWidth = SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= SIDEBAR_MIN_WIDTH && n <= SIDEBAR_MAX_WIDTH) {
        storedWidth = n;
      }
    }
  } catch { /* ignore */ }
  panel.style.width = `${storedWidth}px`;

  const header = document.createElement("div");
  header.className = "nx-panel-header";

  const title = document.createElement("div");
  title.className = "nx-panel-title";
  title.textContent = "Files";

  // `New file` / `New folder` gate on an open vault, but we DON'T use the
  // native `disabled` attribute: a disabled button fires no pointer events, so
  // the browser never shows its `title` tooltip and it reads as dead. Instead
  // we mark it aria-disabled + `.is-inactive` (muted, not-allowed cursor) and
  // let the click handler no-op — tooltips and hover feedback stay alive.
  function setInactive(btn: HTMLButtonElement, inactive: boolean): void {
    btn.classList.toggle("is-inactive", inactive);
    btn.setAttribute("aria-disabled", inactive ? "true" : "false");
  }

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "nx-btn nx-btn--icon";
  openBtn.title = "Open vault…";
  openBtn.setAttribute("aria-label", "Open vault");
  openBtn.appendChild(iconEl("folder"));

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.className = "nx-btn nx-btn--icon";
  newFileBtn.title = "New file at root";
  newFileBtn.setAttribute("aria-label", "New file");
  newFileBtn.appendChild(iconEl("filePlus"));
  setInactive(newFileBtn, true);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.className = "nx-btn nx-btn--icon";
  newFolderBtn.title = "New folder at root";
  newFolderBtn.setAttribute("aria-label", "New folder");
  newFolderBtn.appendChild(iconEl("folderPlus"));
  setInactive(newFolderBtn, true);

  header.append(title, newFileBtn, newFolderBtn, openBtn);

  function syncButtonEnabled(): void {
    const hasVault = vaultPath !== null;
    setInactive(newFileBtn, !hasVault);
    setInactive(newFolderBtn, !hasVault);
  }

  const tree = document.createElement("div");
  tree.className = "nx-panel-body";

  // Drag handle on the right edge — resize / collapse past threshold.
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "nx-sidebar-resize";
  resizeHandle.title = "Drag to resize";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("aria-label", "Resize files sidebar");

  panel.append(header, tree, resizeHandle);

  let vaultPath: string | null = null;
  let currentTree: VaultNode[] = [];
  let activeFile: string | null = null;
  const collapsed = new Set<string>();
  let unsubscribeChanged: (() => void) | null = null;
  let sidebarCollapsed = false;
  let widthBeforeCollapse = storedWidth;

  function renderEmptyState(kind: "no-vault" | "empty"): void {
    tree.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "nx-empty-state";

    const titleEl = document.createElement("div");
    titleEl.className = "nx-empty-state__title";
    titleEl.textContent = kind === "no-vault" ? "Your workspace" : "Empty vault";

    const body = document.createElement("div");
    body.className = "nx-empty-state__body";
    body.textContent =
      kind === "no-vault"
        ? "Open a folder as a knowledge base to start writing."
        : "Create a note to get started.";

    empty.append(titleEl, body);

    if (kind === "no-vault") {
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "nx-btn nx-btn--primary";
      cta.textContent = "打开知识库";
      cta.addEventListener("click", () => void promptPickVault());
      empty.appendChild(cta);
    } else {
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "nx-btn nx-btn--primary";
      cta.textContent = "New note";
      cta.addEventListener("click", () => {
        if (vaultPath) createFilePrompt(vaultPath);
      });
      empty.appendChild(cta);
    }

    tree.appendChild(empty);
  }

  function renderNode(node: VaultNode, depth: number, parent: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "nx-tree-item";
    row.style.paddingLeft = `${10 + depth * 14}px`;
    row.dataset.path = node.path;
    row.dataset.kind = node.kind;

    const isActive = node.kind === "file" && activeFile === node.path;
    if (isActive) row.classList.add("is-active");

    const icon = document.createElement("span");
    icon.className = "nx-tree-item__icon";
    if (node.kind === "directory") {
      const open = !collapsed.has(node.path);
      icon.textContent = folderIcon(open);
    } else {
      icon.textContent = fileIcon();
    }

    const label = document.createElement("span");
    label.className = "nx-tree-item__label";
    label.textContent = node.name;

    row.append(icon, label);
    parent.appendChild(row);

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

  function renderTree(): void {
    tree.innerHTML = "";
    if (!vaultPath) {
      renderEmptyState("no-vault");
      return;
    }
    if (currentTree.length === 0) {
      renderEmptyState("empty");
      return;
    }
    for (const node of currentTree) renderNode(node, 0, tree);
  }

  function beginInlineRename(row: HTMLElement, label: HTMLElement, node: VaultNode): void {
    const input = document.createElement("input");
    input.type = "text";
    input.value = node.name;
    input.className = "nx-input";
    input.style.cssText = "flex:1;width:auto;height:24px;padding:2px 6px;font-size:13px;";
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
        const label = row?.querySelector<HTMLElement>(".nx-tree-item__label");
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
    row.className = "nx-tree-item";
    row.style.paddingLeft = "10px";

    const icon = document.createElement("span");
    icon.className = "nx-tree-item__icon";
    icon.textContent = opts.iconChar;

    const input = document.createElement("input");
    input.type = "text";
    input.value = opts.defaultValue;
    input.className = "nx-input";
    input.style.cssText = "flex:1;width:auto;height:24px;padding:2px 6px;font-size:13px;";

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
    // In Electron window.confirm may be a no-op; the context menu entry is
    // destructive-styled and requires an explicit click, so we proceed directly.
    try {
      await window.nexusDemo.vault.delete(node.path);
      callbacks.onStatus(`Moved ${node.name} to Trash`);
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

  // Right-click empty area / panel background → create file/folder at root.
  function openBackgroundContextMenu(x: number, y: number): void {
    if (!vaultPath) {
      showContextMenu(x, y, [
        {
          label: "Open vault…",
          onClick: () => void promptPickVault(),
        },
      ]);
      return;
    }
    showContextMenu(x, y, [
      {
        label: "New file",
        onClick: () => createFilePrompt(vaultPath!),
      },
      {
        label: "New folder",
        onClick: () => createFolderPrompt(vaultPath!),
      },
    ]);
  }

  tree.addEventListener("contextmenu", (e) => {
    // Node rows handle their own context menu and stopPropagation.
    // Background / empty state lands here.
    if ((e.target as HTMLElement).closest(".nx-tree-item")) return;
    e.preventDefault();
    e.stopPropagation();
    openBackgroundContextMenu(e.clientX, e.clientY);
  });

  // Resize drag
  let resizing = false;
  let startX = 0;
  let startW = 0;

  function setSidebarWidth(width: number, persist: boolean): void {
    const w = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
    panel.style.width = `${w}px`;
    panel.style.minWidth = `${w}px`;
    widthBeforeCollapse = w;
    if (persist) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
      } catch { /* ignore */ }
    }
  }

  function setCollapsed(next: boolean): void {
    sidebarCollapsed = next;
    panel.classList.toggle("is-collapsed", next);
    if (next) {
      panel.style.width = "0px";
      panel.style.minWidth = "0px";
      panel.style.overflow = "hidden";
      panel.style.borderRight = "none";
      resizeHandle.style.display = "none";
    } else {
      panel.style.overflow = "";
      panel.style.borderRight = "";
      resizeHandle.style.display = "";
      setSidebarWidth(widthBeforeCollapse || SIDEBAR_DEFAULT_WIDTH, false);
    }
  }

  const onResizeMove = (e: MouseEvent) => {
    if (!resizing) return;
    const delta = e.clientX - startX;
    const next = startW + delta;
    if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
      // Snap to collapsed while dragging past the threshold.
      panel.style.width = "0px";
      panel.style.minWidth = "0px";
      panel.classList.add("is-collapsing");
      return;
    }
    panel.classList.remove("is-collapsing");
    setSidebarWidth(next, false);
  };

  const onResizeUp = (e: MouseEvent) => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("nx-resizing-sidebar");
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeUp);
    const delta = e.clientX - startX;
    const next = startW + delta;
    panel.classList.remove("is-collapsing");
    if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
      setCollapsed(true);
      return;
    }
    setSidebarWidth(next, true);
  };

  resizeHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.body.classList.add("nx-resizing-sidebar");
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeUp);
  });

  // Double-click handle toggles collapse.
  resizeHandle.addEventListener("dblclick", () => {
    setCollapsed(!sidebarCollapsed);
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
    setCollapsed,
    isCollapsed: () => sidebarCollapsed,
    destroy() {
      if (unsubscribeChanged) unsubscribeChanged();
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
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
