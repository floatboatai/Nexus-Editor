// apps/electron-demo/src/renderer/app.ts
import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";
import { t, setLanguage } from "./i18n";
import { addRecentFile, getRecentFiles } from "./recent-files";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;
let vault: VaultPanel;
let backlinks: BacklinksPanel;

const linkIndex = new LinkIndex();
state.linkIndex = linkIndex;

// ── 自定义模态框 ──
function showConfirmModal(
  message: string,
  options: { saveLabel?: string; discardLabel?: string; cancelLabel?: string } = {}
): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      background: white; border-radius: 8px; padding: 24px;
      max-width: 420px; width: 90%; box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const msg = document.createElement("p");
    msg.textContent = message;
    msg.style.cssText = "margin: 0 0 20px 0; font-size: 14px; color: #1e293b;";

    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = options.saveLabel || "Save & Switch";
    saveBtn.style.cssText = "padding: 6px 16px; border-radius: 4px; border: none; background: #2563eb; color: white; cursor: pointer; font-size: 13px;";
    saveBtn.addEventListener("click", () => { overlay.remove(); resolve("save"); });

    const discardBtn = document.createElement("button");
    discardBtn.textContent = options.discardLabel || "Discard & Switch";
    discardBtn.style.cssText = "padding: 6px 16px; border-radius: 4px; border: 1px solid #d1d5db; background: transparent; color: #1e293b; cursor: pointer; font-size: 13px;";
    discardBtn.addEventListener("click", () => { overlay.remove(); resolve("discard"); });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = options.cancelLabel || "Cancel";
    cancelBtn.style.cssText = "padding: 6px 16px; border-radius: 4px; border: none; background: transparent; color: #6b7280; cursor: pointer; font-size: 13px;";
    cancelBtn.addEventListener("click", () => { overlay.remove(); resolve("cancel"); });

    btnContainer.append(cancelBtn, discardBtn, saveBtn);
    box.append(msg, btnContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); resolve("cancel"); }
    });
  });
}

// ── 渲染最近文件下拉菜单 ──
function renderRecentFilesDropdown(container: HTMLElement): void {
  const files = getRecentFiles();
  container.innerHTML = '';

  if (files.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = t('app.noRecentFiles');
    emptyMsg.style.cssText = 'padding: 8px 16px; color: var(--nexus-text-muted, #888); font-size: 13px;';
    container.appendChild(emptyMsg);
    return;
  }

  for (const filePath of files) {
    const item = document.createElement('div');
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    item.textContent = fileName;
    item.title = filePath;
    item.style.cssText = `
      padding: 6px 16px; cursor: pointer; font-size: 13px;
      color: var(--nexus-text, #24292e);
      transition: background 0.12s;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--nexus-bg-active, #eef)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleVaultFileOpen(filePath);
      container.style.display = 'none';
    });
    container.appendChild(item);
  }
}

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const vaultBtn = document.createElement("button");
  vaultBtn.textContent = t("app.vault");
  vaultBtn.title = t("app.vault");
  vaultBtn.addEventListener("click", () => {
    void vault.promptPickVault();
  });

  const openBtn = document.createElement("button");
  openBtn.textContent = t("app.open");
  openBtn.title = `${t("app.open")} (Ctrl+O)`;
  openBtn.addEventListener("click", handleOpen);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = t("app.save");
  saveBtn.title = `${t("app.save")} (Ctrl+S)`;
  saveBtn.addEventListener("click", handleSave);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.textContent = t("app.saveAs");
  saveAsBtn.title = `${t("app.saveAs")} (Ctrl+Shift+S)`;
  saveAsBtn.addEventListener("click", handleSaveAs);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const vaultToggleBtn = document.createElement("button");
  vaultToggleBtn.textContent = "\uD83D\uDCD1";
  vaultToggleBtn.title = t("app.toggleVault");
  vaultToggleBtn.style.fontSize = "14px";
  vaultToggleBtn.addEventListener("click", toggleVault);

  const outlineBtn = document.createElement("button");
  outlineBtn.textContent = "\u2630";
  outlineBtn.title = t("app.toggleOutline");
  outlineBtn.style.fontSize = "14px";
  outlineBtn.addEventListener("click", toggleOutline);

  const backlinksBtn = document.createElement("button");
  backlinksBtn.textContent = "\uD83D\uDD17";
  backlinksBtn.title = t("app.toggleBacklinks");
  backlinksBtn.style.fontSize = "14px";
  backlinksBtn.addEventListener("click", toggleBacklinks);

  // 最近文件按钮
  const recentBtn = document.createElement("button");
  recentBtn.textContent = "📋";
  recentBtn.title = t("app.recentFiles");
  recentBtn.style.fontSize = "14px";
  recentBtn.style.position = "relative";

  const dropdown = document.createElement("div");
  dropdown.id = "recent-files-dropdown";
  dropdown.style.cssText = `
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--nexus-bg, #fff);
    border: 1px solid var(--nexus-border, #ddd);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    min-width: 200px;
    max-height: 300px;
    overflow-y: auto;
    z-index: 1000;
    padding: 4px 0;
  `;

  recentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    if (isOpen) {
      dropdown.style.display = "none";
      return;
    }
    renderRecentFilesDropdown(dropdown);
    dropdown.style.display = "block";
  });

  document.addEventListener("click", () => {
    dropdown.style.display = "none";
  });

  recentBtn.appendChild(dropdown);

  const searchBtn = document.createElement("button");
  searchBtn.textContent = "\uD83D\uDD0D";
  searchBtn.title = t("app.search");
  searchBtn.style.fontSize = "14px";
  searchBtn.addEventListener("click", () => searchBar.open());

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "\u2699";
  settingsBtn.title = t("app.settings");
  settingsBtn.style.fontSize = "16px";
  settingsBtn.addEventListener("click", handleSettings);

  toolbar.append(
    vaultBtn,
    openBtn,
    saveBtn,
    saveAsBtn,
    spacer,
    vaultToggleBtn,
    outlineBtn,
    backlinksBtn,
    recentBtn,
    searchBtn,
    settingsBtn
  );
  return toolbar;
}

function createStatusLine(): HTMLElement {
  const status = document.createElement("div");
  status.className = "status-line";
  status.id = "status-line";
  return status;
}

function renderStatus(): void {
  const el = document.getElementById("status-line");
  if (!el) return;

  const pathLabel = state.activeFile ?? state.filePath ?? t("app.untitled");
  const dirtyMark = state.dirty ? ` ${t("app.modified")}` : "";
  const stats = shell?.editor.getDocumentStats();
  const statsText = stats
    ? ` | ${t("app.status.stats", { words: stats.words, lines: stats.lines })}`
    : "";
  const vaultLabel = state.vaultPath
    ? ` | ${t("app.status.vault", { name: state.vaultPath.split(/[\\/]/).pop() || "" })}`
    : "";
  const errorText = state.error ? ` — ${t("app.status.error", { message: state.error })}` : "";
  el.textContent = `${pathLabel}${dirtyMark}${statsText}${vaultLabel}${errorText}`;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!state.dirty) return true;
  const result = await showConfirmModal(
    t("confirm.dirty.title"),
    {
      saveLabel: t("confirm.dirty.save"),
      discardLabel: t("confirm.dirty.discard"),
      cancelLabel: t("confirm.dirty.cancel"),
    }
  );
  if (result === "save") {
    await handleSave();
    return true;
  }
  if (result === "discard") {
    return true;
  }
  return false;
}

async function handleOpen(): Promise<void> {
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;
    const result = await window.nexusDemo.openFile();
    if (!result) return;

    addRecentFile(result.path);
    state.filePath = result.path;
    state.activeFile = result.path;
    shell.loadDocument(result.content);
    vault.setActiveFile(result.path);
    backlinks.refresh();
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
}

async function handleSave(): Promise<void> {
  try {
    state.error = null;
    const targetPath = state.activeFile ?? state.filePath;
    if (targetPath) {
      if (state.vaultPath && targetPath.startsWith(state.vaultPath)) {
        await window.nexusDemo.vault.write(targetPath, state.content);
      } else {
        await window.nexusDemo.saveFile(targetPath, state.content);
      }
      state.dirty = false;
    } else {
      await handleSaveAs();
      return;
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
}

async function handleSaveAs(): Promise<void> {
  try {
    state.error = null;
    const result = await window.nexusDemo.saveFileAs(state.content);
    if (!result) return;

    addRecentFile(result.path);
    state.filePath = result.path;
    state.activeFile = result.path;
    state.dirty = false;
    vault.setActiveFile(result.path);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
}

function handleSettings(): void {
  createSettingsPanel(settings, (next) => {
    settings = next;
    shell.applySettings(settings);
  });
}

function togglePanel(panel: HTMLElement, onShow?: () => void): void {
  if (panel.style.display === "none") {
    panel.style.display = "";
    onShow?.();
  } else {
    panel.style.display = "none";
  }
}

function toggleOutline(): void {
  togglePanel(outline.element, () => outline.update());
}

function toggleVault(): void {
  togglePanel(vault.element);
}

function toggleBacklinks(): void {
  togglePanel(backlinks.element, () => backlinks.refresh());
}

async function handleVaultFileOpen(filePath: string): Promise<void> {
  const total = perfStart("open-file", { filePath });
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;

    const ipc = perfStart("open-file.ipc-read");
    const result = await window.nexusDemo.vault.read(filePath);
    perfEnd(ipc, { bytes: result.content.length });

    addRecentFile(result.path);
    state.filePath = result.path;
    state.activeFile = result.path;

    const load = perfStart("open-file.loadDocument");
    shell.loadDocument(result.content);
    perfEnd(load);

    const setActive = perfStart("open-file.vault.setActiveFile");
    vault.setActiveFile(result.path);
    perfEnd(setActive);

    const bl = perfStart("open-file.backlinks.refresh");
    backlinks.refresh();
    perfEnd(bl);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
  perfEnd(total);
}

function dirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(0, slash) : "";
}

let seedToken = 0;
async function seedLinkIndex(): Promise<void> {
  const myToken = ++seedToken;
  const total = perfStart("seed-link-index");
  try {
    const ipc = perfStart("seed-link-index.ipc-readAll");
    const files = await window.nexusDemo.vault.readAll();
    const totalBytes = files.reduce((n, f) => n + f.content.length, 0);
    perfEnd(ipc, { files: files.length, bytes: totalBytes });

    if (myToken !== seedToken) {
      perfEnd(total, { superseded: true });
      return;
    }

    const rebuild = perfStart("seed-link-index.rebuildAsync");
    const committed = await linkIndex.rebuildAsync(files, {
      isCancelled: () => myToken !== seedToken,
    });
    perfEnd(rebuild, { files: files.length, committed });
    if (!committed) {
      perfEnd(total, { superseded: true });
      return;
    }
  } catch (err) {
    console.warn("seedLinkIndex failed:", err);
  }
  perfEnd(total);
}

async function handleWikilinkNavigate(target: string, opts: { unresolved: boolean }): Promise<void> {
  try {
    state.error = null;
    const { bare, anchor } = parseAnchor(target);
    if (!bare && !anchor) return;

    if (!bare && anchor && state.activeFile) {
      const pos = findAnchorPosition(state.content, anchor);
      if (pos !== null) shell.editor.setSelection(pos);
      return;
    }
    if (!bare) return;

    if (!opts.unresolved) {
      const resolved = linkIndex.resolve(bare, state.activeFile);
      if (resolved) {
        await handleVaultFileOpen(resolved);
        if (anchor) {
          const pos = findAnchorPosition(state.content, anchor);
          if (pos !== null) shell.editor.setSelection(pos);
        }
      }
      return;
    }
    if (!state.vaultPath) {
      state.error = "Open a vault before following wiki links.";
      renderStatus();
      return;
    }
    const hasSubpath = bare.includes("/") || bare.includes("\\");
    const parent = hasSubpath
      ? state.vaultPath
      : state.activeFile
        ? dirname(state.activeFile)
        : state.vaultPath;
    const name = bare.toLowerCase().endsWith(".md") ? bare : `${bare}.md`;
    const created = await window.nexusDemo.vault.createFile(parent, name);
    await vault.refresh();
    linkIndex.updateFile(created.path, "");
    await handleVaultFileOpen(created.path);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    renderStatus();
  }
}

async function tryRestoreLastVault(): Promise<void> {
  try {
    const last = await window.nexusDemo.vault.getLast();
    if (last.lastVault) {
      state.vaultPath = last.lastVault;
      await vault.openVault(last.lastVault);
      renderStatus();
      void seedLinkIndex();
    }
  } catch (err) {
    console.warn("Could not restore last vault:", err);
  }
}

function boot(): void {
  // 应用语言设置
  setLanguage(settings.language);

  const bootScope = perfStart("boot");
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");

  const appToolbar = createAppToolbar();
  const statusLine = createStatusLine();

  const mainArea = document.createElement("div");
  mainArea.className = "main-area";

  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";

  root.append(appToolbar, mainArea, statusLine);

  shell = createEditorShell({
    container: editorContainer,
    state,
    settings,
    onStateChange: renderStatus,
    resolveWikilink: (name) => linkIndex.resolve(name, state.activeFile),
    suggestWikilinks: (q) => {
      const names = linkIndex.getAllNoteNames();
      if (!q) return names.slice(0, 50);
      const qLower = q.toLowerCase();
      return names.filter((n) => n.toLowerCase().includes(qLower)).slice(0, 50);
    },
    onWikilinkNavigate: (target, opts) => {
      void handleWikilinkNavigate(target, opts);
    },
  });

  vault = createVaultPanel({
    onOpenFile: (filePath) => {
      void handleVaultFileOpen(filePath);
    },
    onError: (message) => {
      state.error = message;
      renderStatus();
    },
    onStatus: (_message) => {
      renderStatus();
    },
  });

  const originalOpenVault = vault.openVault;
  vault.openVault = async (nextPath: string) => {
    await originalOpenVault(nextPath);
    state.vaultPath = nextPath;
    renderStatus();
    void seedLinkIndex();
  };

  outline = createOutlinePanel(shell.editor);
  searchBar = createSearchBar(shell.editor);
  backlinks = createBacklinksPanel({
    index: linkIndex,
    onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
    getActiveFile: () => state.activeFile,
  });

  editorColumn.append(searchBar.element, editorContainer);
  mainArea.append(vault.element, editorColumn, outline.element, backlinks.element);

  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  // 键盘快捷键
  document.addEventListener("keydown", (e) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && e.key === "f") {
      e.preventDefault();
      searchBar.open();
      return;
    }
    if (ctrlOrCmd && e.key === "s" && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (ctrlOrCmd && e.key === "o" && !e.shiftKey) {
      e.preventDefault();
      void handleOpen();
      return;
    }
    if (ctrlOrCmd && e.shiftKey && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      void handleSaveAs();
      return;
    }
  });

  renderStatus();
  perfEnd(bootScope);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        void tryRestoreLastVault();
      }, 0);
    });
  });
}

boot();