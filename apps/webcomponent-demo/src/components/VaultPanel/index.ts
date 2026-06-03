import './VaultPanel.css';

export interface VaultPanelCallbacks {
  onOpenFile(filePath: string): void;
  onError(message: string): void;
  onStatus(message: string): void;
}

export interface VaultPanel {
  element: HTMLElement;
  openVault(vaultPath: string): Promise<void>;
  refresh(): Promise<void>;
  setActiveFile(filePath: string | null): void;
  getVaultPath(): string | null;
  destroy(): void;
}

interface VaultNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: VaultNode[];
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

  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.destructive) btn.classList.add("destructive");
    
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
  return open ? "\u25BE" : "\u25B8";
}

function fileIcon(): string {
  return "\u00B7";
}

const VAULT_STORAGE_KEY = "nexus-web-vault";

interface VaultStorage {
  files: Record<string, string>;
  vaultName: string;
}

function loadVaultStorage(): VaultStorage {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    files: {
      "Welcome.md": "# Welcome to Nexus Editor\n\nThis is a **Markdown** editor demo.\n\n## Features\n\n- Real-time preview\n- GFM support\n- Keyboard shortcuts\n- Search functionality\n- Wiki links (`[[page]]`)\n\n## Code Example\n\n```javascript\nconst editor = document.querySelector('nexus-editor');\neditor.value = '# Hello';\n```\n\n## Task List\n\n- [x] Basic editing\n- [x] Formatting\n- [x] Search\n- [ ] Advanced features\n\n## Wiki Links\n\nTry creating wiki links: [[My Note]]\n",
      "Notes/Getting Started.md": "# Getting Started\n\nThis is your getting started guide.\n\n### Step 1\n\nStart editing your first note!\n\n### Step 2\n\nCreate more notes and link them together.\n",
      "Notes/Ideas.md": "# Ideas\n\n- Project ideas\n- Feature requests\n- TODO items\n",
    },
    vaultName: "My Vault",
  };
}

function saveVaultStorage(storage: VaultStorage): void {
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(storage));
  } catch {
    /* ignore */
  }
}

function buildTree(files: Record<string, string>): VaultNode[] {
  const root: VaultNode[] = [];
  const dirs = new Map<string, VaultNode>();

  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    let current: VaultNode[] = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        current.push({
          name: part,
          path: currentPath,
          kind: "file",
        });
      } else {
        let dir = dirs.get(currentPath);
        if (!dir) {
          dir = {
            name: part,
            path: currentPath,
            kind: "directory",
            children: [],
          };
          dirs.set(currentPath, dir);
          current.push(dir);
        }
        current = dir.children!;
      }
    }
  }

  const sortNodes = (nodes: VaultNode[]): VaultNode[] => {
    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }).map(node => {
      if (node.children) {
        return { ...node, children: sortNodes(node.children) };
      }
      return node;
    });
  };

  return sortNodes(root);
}

export function createVaultPanel(callbacks: VaultPanelCallbacks): VaultPanel {
  const panel = document.createElement("div");
  panel.className = "nexus-vault-panel";

  const header = document.createElement("div");
  header.className = "vault-header";

  const title = document.createElement("div");
  title.className = "vault-header-title";
  title.textContent = "Vault";

  const newFileBtn = document.createElement("button");
  newFileBtn.type = "button";
  newFileBtn.className = "vault-icon-btn";
  newFileBtn.textContent = "\u002B";
  newFileBtn.title = "New file";

  const newFolderBtn = document.createElement("button");
  newFolderBtn.type = "button";
  newFolderBtn.className = "vault-icon-btn";
  newFolderBtn.textContent = "\uD83D\uDCC2";
  newFolderBtn.title = "New folder";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "vault-icon-btn";
  clearBtn.textContent = "\uD83D\uDDD1";
  clearBtn.title = "Reset vault";

  header.append(title, newFileBtn, newFolderBtn, clearBtn);

  const tree = document.createElement("div");
  tree.className = "vault-tree";

  panel.append(header, tree);

  let vaultPath = "web-vault";
  let currentTree: VaultNode[] = [];
  let activeFile: string | null = null;
  const collapsed = new Set<string>();

  function getStorage(): VaultStorage {
    return loadVaultStorage();
  }

  function saveStorage(storage: VaultStorage): void {
    saveVaultStorage(storage);
  }

  function renderEmpty(message: string): void {
    tree.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "vault-empty";
    empty.textContent = message;
    tree.appendChild(empty);
  }

  function renderNode(node: VaultNode, depth: number, parent: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "vault-item";
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = node.path;
    row.dataset.kind = node.kind;

    const isActive = node.kind === "file" && activeFile === node.path;
    if (isActive) row.classList.add("active");

    const icon = document.createElement("span");
    icon.className = "vault-item-icon";
    if (node.kind === "directory") {
      const open = !collapsed.has(node.path);
      icon.textContent = folderIcon(open);
    } else {
      icon.textContent = fileIcon();
    }

    const label = document.createElement("span");
    label.className = "vault-item-label";
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
    const storage = getStorage();
    title.textContent = storage.vaultName || "Vault";
    currentTree = buildTree(storage.files);
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
    input.className = "vault-rename-input";
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
        const storage = getStorage();
        const content = storage.files[node.path];
        delete storage.files[node.path];
        
        const parentDir = node.path.replace(/[\\/][^\\/]+$/, "");
        const newPath = parentDir ? `${parentDir}/${newName}` : newName;
        storage.files[newPath] = content!;
        saveStorage(storage);
        
        if (activeFile === node.path) {
          activeFile = newPath;
        }
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
    row.className = "vault-item";
    row.style.paddingLeft = "8px";

    const icon = document.createElement("span");
    icon.className = "vault-item-icon";
    icon.textContent = opts.iconChar;

    const input = document.createElement("input");
    input.type = "text";
    input.value = opts.defaultValue;
    input.className = "vault-rename-input";

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
        const storage = getStorage();
        const path = parentDir ? `${parentDir}/${name}` : name;
        storage.files[path] = `# ${name.replace(/\.md$/, "")}\n\n`;
        saveStorage(storage);
        await refresh();
        callbacks.onOpenFile(path);
      },
    });
  }

  function createFolderPrompt(parentDir: string): void {
    inlineInputRow({
      defaultValue: "new-folder",
      selectExt: false,
      iconChar: folderIcon(true),
      onCommit: async (name) => {
        const storage = getStorage();
        const path = parentDir ? `${parentDir}/${name}` : name;
        storage.files[`${path}/.placeholder`] = "";
        saveStorage(storage);
        await refresh();
      },
    });
  }

  async function deleteNode(node: VaultNode): Promise<void> {
    try {
      const storage = getStorage();
      const pathsToDelete = node.kind === "directory"
        ? Object.keys(storage.files).filter(p => p.startsWith(node.path + "/") || p === node.path)
        : [node.path];
      
      for (const path of pathsToDelete) {
        delete storage.files[path];
      }
      
      saveStorage(storage);
      callbacks.onStatus(`Deleted ${node.name}`);
      
      if (node.kind === "file" && activeFile === node.path) {
        activeFile = null;
      }
      await refresh();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(): Promise<void> {
    renderTree();
  }

  async function openVault(_nextPath: string): Promise<void> {
    vaultPath = "web-vault";
    collapsed.clear();
    await refresh();
  }

  function resetVault(): void {
    if (confirm("Are you sure you want to reset the vault? All files will be restored to default.")) {
      localStorage.removeItem(VAULT_STORAGE_KEY);
      activeFile = null;
      collapsed.clear();
      renderTree();
      callbacks.onStatus("Vault reset to default");
    }
  }

  newFileBtn.addEventListener("click", () => {
    createFilePrompt("");
  });

  newFolderBtn.addEventListener("click", () => {
    createFolderPrompt("");
  });

  clearBtn.addEventListener("click", resetVault);

  renderTree();

  return {
    element: panel,
    openVault,
    refresh,
    setActiveFile(filePath) {
      activeFile = filePath;
      renderTree();
    },
    getVaultPath: () => vaultPath,
    destroy() {
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