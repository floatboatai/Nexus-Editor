import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, applyThemeToDocument, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";
import { t, setLocale, onLocaleChange } from "./i18n";

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

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const vaultBtn = document.createElement("button");
  vaultBtn.textContent = t("toolbar.vault");
  vaultBtn.title = t("toolbar.vault.title");
  vaultBtn.addEventListener("click", () => {
    void vault.promptPickVault();
  });

  const openBtn = document.createElement("button");
  openBtn.textContent = t("toolbar.open");
  openBtn.addEventListener("click", handleOpen);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = t("toolbar.save");
  saveBtn.addEventListener("click", handleSave);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.textContent = t("toolbar.saveAs");
  saveAsBtn.addEventListener("click", handleSaveAs);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const vaultToggleBtn = document.createElement("button");
  vaultToggleBtn.textContent = "\uD83D\uDCD1"; // 📑
  vaultToggleBtn.title = t("toolbar.toggleVault.title");
  vaultToggleBtn.style.fontSize = "14px";
  vaultToggleBtn.classList.add("active"); // 默认显示
  vaultToggleBtn.addEventListener("click", () => {
    toggleVault();
    vaultToggleBtn.classList.toggle("active");
  });

  const outlineBtn = document.createElement("button");
  outlineBtn.textContent = "\u2630"; // ☰
  outlineBtn.title = t("toolbar.toggleOutline.title");
  outlineBtn.style.fontSize = "14px";
  // 默认隐藏，不加 active
  outlineBtn.addEventListener("click", () => {
    toggleOutline();
    outlineBtn.classList.toggle("active");
  });

  const backlinksBtn = document.createElement("button");
  backlinksBtn.textContent = "\uD83D\uDD17"; // 🔗
  backlinksBtn.title = t("toolbar.toggleBacklinks.title");
  backlinksBtn.style.fontSize = "14px";
  // 默认隐藏，不加 active
  backlinksBtn.addEventListener("click", () => {
    toggleBacklinks();
    backlinksBtn.classList.toggle("active");
  });

  const searchBtn = document.createElement("button");
  searchBtn.id = "toolbar-search-btn";
  searchBtn.textContent = "\uD83D\uDD0D"; // 🔍
  searchBtn.title = t("toolbar.search.title");
  searchBtn.style.fontSize = "14px";
  searchBtn.addEventListener("click", () => searchBar.open());

  const settingsBtn = document.createElement("button");
  settingsBtn.id = "toolbar-settings-btn";
  settingsBtn.textContent = "\u2699"; // ⚙
  settingsBtn.title = t("toolbar.settings.title");
  settingsBtn.style.fontSize = "16px";
  settingsBtn.addEventListener("click", handleSettings);

  // 语言切换时更新 toolbar 文本
  onLocaleChange(() => {
    vaultBtn.textContent = t("toolbar.vault");
    vaultBtn.title = t("toolbar.vault.title");
    openBtn.textContent = t("toolbar.open");
    saveBtn.textContent = t("toolbar.save");
    saveAsBtn.textContent = t("toolbar.saveAs");
    vaultToggleBtn.title = t("toolbar.toggleVault.title");
    outlineBtn.title = t("toolbar.toggleOutline.title");
    backlinksBtn.title = t("toolbar.toggleBacklinks.title");
    searchBtn.title = t("toolbar.search.title");
    settingsBtn.title = t("toolbar.settings.title");
    renderStatus();
  });

  toolbar.append(
    vaultBtn,
    openBtn,
    saveBtn,
    saveAsBtn,
    spacer,
    vaultToggleBtn,
    outlineBtn,
    backlinksBtn,
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

  const pathLabel = state.activeFile ?? state.filePath ?? t("status.untitled");
  const dirtyMark = state.dirty ? t("status.modified") : "";
  const stats = shell?.editor.getDocumentStats();
  const statsText = stats ? ` | ${stats.words} ${t("status.words")}, ${stats.lines} ${t("status.lines")}` : "";
  const vaultLabel = state.vaultPath
    ? ` | ${t("status.vault")}: ${state.vaultPath.split(/[\\/]/).pop()}`
    : "";
  const errorText = state.error ? ` — ${t("status.error")}: ${state.error}` : "";
  el.textContent = `${pathLabel}${dirtyMark}${statsText}${vaultLabel}${errorText}`;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!state.dirty) return true;
  return window.confirm("You have unsaved changes. Discard them and switch files?");
}

async function handleOpen(): Promise<void> {
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;
    const result = await window.nexusDemo.openFile();
    if (!result) return;

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
  const settingsBtn = document.getElementById("toolbar-settings-btn");
  settingsBtn?.classList.add("active");

  const panel = createSettingsPanel(settings, (next) => {
    settings = next;
    shell.applySettings(settings);
    applyThemeToDocument(settings);
  });

  // 面板关闭时移除激活状态
  const observer = new MutationObserver(() => {
    if (!document.body.contains(panel.element)) {
      settingsBtn?.classList.remove("active");
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });
}

function togglePanel(panel: HTMLElement, onShow?: () => void): void {
  if (panel.style.display === "none") {
    panel.style.display = "";
    onShow?.();
  } else {
    panel.style.display = "none";
  }
}

let toggleOutline = (): void => {};
let toggleVault = (): void => {};
let toggleBacklinks = (): void => {};

async function handleVaultFileOpen(filePath: string): Promise<void> {
  const total = perfStart("open-file", { filePath });
  try {
    state.error = null;
    if (!(await confirmDiscardIfDirty())) return;

    const ipc = perfStart("open-file.ipc-read");
    const result = await window.nexusDemo.vault.read(filePath);
    perfEnd(ipc, { bytes: result.content.length });

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

/** Coalesce repeated re-seeds (e.g. a burst of FS changes) into a single run. */
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
    // Parse `#heading` / `^blockid` — bare part is what the resolver needs
    // to match a file on disk; the anchor (if any) is used AFTER the file is
    // loaded to scroll the editor to the matching heading / block.
    const { bare, anchor } = parseAnchor(target);
    if (!bare && !anchor) return;

    // `[[#heading]]` with no bare target means "jump inside the current file".
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
    // Decide the create anchor:
    //   - Target contains `/` → vault-relative path (matches Obsidian semantics
    //     for explicit subpath links). Intermediate folders are auto-created.
    //   - Otherwise → next to the active file.
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
      // Build link index in the background — the editor is usable without it.
      void seedLinkIndex();
    }
  } catch (err) {
    // swallow — missing vault is a normal case
    console.warn("Could not restore last vault:", err);
  }
}

function boot(): void {
  const bootScope = perfStart("boot");
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");

  // 启动时初始化语言和主题
  setLocale(settings.locale);
  applyThemeToDocument(settings);

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

  // Keep state in sync when the vault panel picks a new vault.
  const originalOpenVault = vault.openVault;
  vault.openVault = async (nextPath: string) => {
    await originalOpenVault(nextPath);
    state.vaultPath = nextPath;
    renderStatus();
    // Index in the background — don't block the editor on it.
    void seedLinkIndex();
  };

  outline = createOutlinePanel(shell.editor);
  searchBar = createSearchBar(shell.editor);
  backlinks = createBacklinksPanel({
    index: linkIndex,
    onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
    getActiveFile: () => state.activeFile,
  });

  // 搜索按钮激活状态联动：通过 onClose 回调同步 .active 类
  const searchBtnEl = document.getElementById("toolbar-search-btn");
  if (searchBtnEl) {
    const origOpen = searchBar.open.bind(searchBar);
    searchBar.open = () => { origOpen(); searchBtnEl.classList.add("active"); };
    searchBar.onClose = () => searchBtnEl.classList.remove("active");
  }

  editorColumn.append(searchBar.element, editorContainer);

  // 创建可拖动分隔条（vault右 / outline左 / backlinks左）
  function makeResizeHandle(
    panel: HTMLElement,
    direction: "right" | "left"
  ): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "resize-handle";

    handle.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        // 向右拖 handle 时：right 方向扩展面板，left 方向缩小面板
        const newW = direction === "right"
          ? Math.min(350, Math.max(100, startW + delta))
          : Math.min(350, Math.max(100, startW - delta));
        panel.style.width = newW + "px";
      };

      const onUp = () => {
        handle.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    return handle;
  }

  const vaultHandle = makeResizeHandle(vault.element, "right");
  const outlineHandle = makeResizeHandle(outline.element, "left");
  const backlinkHandle = makeResizeHandle(backlinks.element, "left");

  // 默认只显示左侧 vault 面板，outline 和 backlinks 默认隐藏
  outline.element.style.display = "none";
  outlineHandle.style.display = "none";
  backlinks.element.style.display = "none";
  backlinkHandle.style.display = "none";

  // 将面板切换函数绑定到 handle，确保分隔条随面板一起显隐
  toggleVault = () => {
    const visible = vault.element.style.display === "none";
    vault.element.style.display = visible ? "" : "none";
    vaultHandle.style.display = visible ? "" : "none";
  };
  toggleOutline = () => {
    const visible = outline.element.style.display === "none";
    outline.element.style.display = visible ? "" : "none";
    outlineHandle.style.display = visible ? "" : "none";
    if (visible) outline.update();
  };
  toggleBacklinks = () => {
    const visible = backlinks.element.style.display === "none";
    backlinks.element.style.display = visible ? "" : "none";
    backlinkHandle.style.display = visible ? "" : "none";
    if (visible) backlinks.refresh();
  };

  mainArea.append(vault.element, vaultHandle, editorColumn, outlineHandle, outline.element, backlinkHandle, backlinks.element);

  // External file changes → re-seed the index (cheap for typical vaults).
  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      searchBar.open();
    }
  });

  renderStatus();
  perfEnd(bootScope);

  // Defer vault restore until after first paint so the window pops open with
  // a usable UI; the vault read + link-index seed then runs while the user
  // is still looking at the empty editor — invisible to them.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        void tryRestoreLastVault();
      }, 0);
    });
  });
}

boot();
