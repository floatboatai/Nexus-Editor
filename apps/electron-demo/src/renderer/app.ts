import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, settingsToTheme, applyThemeVars, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;
let vault: VaultPanel;
let backlinks: BacklinksPanel;
let vaultWrapper: HTMLElement;
let outlineWrapper: HTMLElement;
let backlinksWrapper: HTMLElement;
let leftResizer: HTMLElement & { refresh?: () => void };
let middleResizer: HTMLElement & { refresh?: () => void };
let rightResizer: HTMLElement & { refresh?: () => void };

type PanelCollapseSide = "left" | "right";

function createPanelWrapper(panel: HTMLElement, width: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "panel-wrapper";
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    width: ${width}px;
    min-width: 0;
    max-width: 640px;
    overflow: hidden;
  `;
  wrapper.append(panel);
  return wrapper;
}

function setPanelCollapsed(wrapper: HTMLElement, collapsed: boolean, defaultWidth: number): void {
  const panel = wrapper.firstElementChild as HTMLElement | null;
  if (collapsed) {
    if (!wrapper.dataset.prevWidth) {
      wrapper.dataset.prevWidth = wrapper.style.width || `${defaultWidth}px`;
    }
    wrapper.classList.add("panel-collapsed");
    wrapper.style.width = "0";
    wrapper.style.minWidth = "0";
    wrapper.style.maxWidth = "0";
    wrapper.style.flexBasis = "0";
    if (panel) panel.style.display = "none";
  } else {
    wrapper.classList.remove("panel-collapsed");
    wrapper.style.width = wrapper.dataset.prevWidth || `${defaultWidth}px`;
    wrapper.style.minWidth = "";
    wrapper.style.maxWidth = "";
    wrapper.style.flexBasis = "";
    if (panel) panel.style.display = "";
  }
  updateResizerVisibility();
}

function updateResizerVisibility(): void {
  const maybeRefresh = (resizer: HTMLElement & { refresh?: () => void } | undefined) => {
    if (!resizer) return;
    resizer.refresh?.();
  };

  maybeRefresh(leftResizer);
  maybeRefresh(middleResizer);
  maybeRefresh(rightResizer);
}

function createPanelResizer(
  leftPanel: HTMLElement,
  rightPanel: HTMLElement,
  options: { side: PanelCollapseSide; toggledPanel: HTMLElement; expandTitle: string; collapseTitle: string; defaultWidth: number }
): HTMLElement {
  const { side, toggledPanel, expandTitle, collapseTitle, defaultWidth } = options;

  const wrapper = document.createElement("div");
  wrapper.className = "panel-resizer";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "panel-collapse-button";
  button.style.userSelect = "none";

  const isCollapsed = () => toggledPanel.classList.contains("panel-collapsed");

  const updateButton = () => {
    const collapsed = isCollapsed();
    button.textContent = side === "left" ? (collapsed ? "⟩" : "⟨") : (collapsed ? "⟨" : "⟩");
    button.title = collapsed ? expandTitle : collapseTitle;
  };

  const updateVisibility = () => {
    wrapper.style.display = leftPanel.classList.contains("panel-collapsed") || rightPanel.classList.contains("panel-collapsed") ? "none" : "flex";
  };

  wrapper.refresh = () => {
    updateButton();
    updateVisibility();
  };

  updateButton();
  updateVisibility();
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const collapsed = isCollapsed();
    setPanelCollapsed(toggledPanel, !collapsed, defaultWidth);
    updateButton();
  });

  wrapper.append(button);

  let startX = 0;
  let leftStart = 0;
  let rightStart = 0;
  const minLeft = 120;
  const minRight = 120;

  const onMouseMove = (event: MouseEvent) => {
    const delta = event.clientX - startX;
    const totalWidth = leftStart + rightStart;
    const newLeftWidth = Math.max(minLeft, Math.min(totalWidth - minRight, leftStart + delta));
    const newRightWidth = Math.max(minRight, totalWidth - newLeftWidth);
    leftPanel.style.width = `${newLeftWidth}px`;
    rightPanel.style.width = `${newRightWidth}px`;
    if (leftPanel === outlineWrapper || leftPanel === backlinksWrapper) {
      leftPanel.style.minWidth = "0";
    }
    if (rightPanel === outlineWrapper || rightPanel === backlinksWrapper) {
      rightPanel.style.minWidth = "0";
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  wrapper.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startX = event.clientX;
    leftStart = leftPanel.getBoundingClientRect().width;
    rightStart = rightPanel.getBoundingClientRect().width;
    setPanelCollapsed(toggledPanel, false, defaultWidth);
    updateButton();
    updateVisibility();
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  return wrapper;
}

const linkIndex = new LinkIndex();
state.linkIndex = linkIndex;

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const vaultBtn = document.createElement("button");
  vaultBtn.textContent = "Vault";
  vaultBtn.title = "Open a folder as a vault";
  vaultBtn.addEventListener("click", () => {
    void vault.promptPickVault();
  });

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", handleOpen);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", handleSave);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.textContent = "Save As";
  saveAsBtn.addEventListener("click", handleSaveAs);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const vaultToggleBtn = document.createElement("button");
  vaultToggleBtn.textContent = "\uD83D\uDCD1"; // 📑
  vaultToggleBtn.title = "Toggle vault panel";
  vaultToggleBtn.style.fontSize = "14px";
  vaultToggleBtn.addEventListener("click", toggleVault);

  const outlineBtn = document.createElement("button");
  outlineBtn.textContent = "\u2630"; // ☰
  outlineBtn.title = "Toggle outline";
  outlineBtn.style.fontSize = "14px";
  outlineBtn.addEventListener("click", toggleOutline);

  const backlinksBtn = document.createElement("button");
  backlinksBtn.textContent = "\uD83D\uDD17"; // 🔗
  backlinksBtn.title = "Toggle backlinks panel";
  backlinksBtn.style.fontSize = "14px";
  backlinksBtn.addEventListener("click", toggleBacklinks);

  const searchBtn = document.createElement("button");
  searchBtn.textContent = "\uD83D\uDD0D"; // 🔍
  searchBtn.title = "Search (Ctrl+F)";
  searchBtn.style.fontSize = "14px";
  searchBtn.addEventListener("click", () => searchBar.open());

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "\u2699"; // ⚙
  settingsBtn.title = "Settings";
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

  const pathLabel = state.activeFile ?? state.filePath ?? "Untitled";
  const dirtyMark = state.dirty ? " [modified]" : "";
  const stats = shell?.editor.getDocumentStats();
  const statsText = stats ? ` | ${stats.words} words, ${stats.lines} lines` : "";
  const vaultLabel = state.vaultPath
    ? ` | Vault: ${state.vaultPath.split(/[\\/]/).pop()}`
    : "";
  const errorText = state.error ? ` — Error: ${state.error}` : "";
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
  createSettingsPanel(settings, (next) => {
    settings = next;
    shell.applySettings(settings);
    applyThemeVars(settingsToTheme(settings));
  });
}

function togglePanel(wrapper: HTMLElement, defaultWidth: number, onShow?: () => void): void {
  const collapsed = wrapper.classList.contains("panel-collapsed");
  setPanelCollapsed(wrapper, !collapsed, defaultWidth);
  if (collapsed) {
    onShow?.();
  }
}

function toggleOutline(): void {
  togglePanel(outlineWrapper, 220, () => outline.update());
}

function toggleVault(): void {
  togglePanel(vaultWrapper, 240);
}

function toggleBacklinks(): void {
  togglePanel(backlinksWrapper, 280, () => backlinks.refresh());
}

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

  const appToolbar = createAppToolbar();
  const statusLine = createStatusLine();

  const mainArea = document.createElement("div");
  mainArea.className = "main-area";

  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";

  root.append(appToolbar, mainArea, statusLine);

  applyThemeVars(settingsToTheme(settings));

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

  editorColumn.append(searchBar.element, editorContainer);

  vaultWrapper = createPanelWrapper(vault.element, 240);
  outlineWrapper = createPanelWrapper(outline.element, 220);
  backlinksWrapper = createPanelWrapper(backlinks.element, 280);

  const leftResizer = createPanelResizer(vaultWrapper, editorColumn, {
    side: "left",
    toggledPanel: vaultWrapper,
    expandTitle: "Show vault panel",
    collapseTitle: "Hide vault panel",
    defaultWidth: 240,
  });

  const middleResizer = createPanelResizer(editorColumn, outlineWrapper, {
    side: "right",
    toggledPanel: outlineWrapper,
    expandTitle: "Show outline panel",
    collapseTitle: "Hide outline panel",
    defaultWidth: 220,
  });

  const rightResizer = createPanelResizer(outlineWrapper, backlinksWrapper, {
    side: "right",
    toggledPanel: backlinksWrapper,
    expandTitle: "Show backlinks panel",
    collapseTitle: "Hide backlinks panel",
    defaultWidth: 280,
  });

  mainArea.append(vaultWrapper, leftResizer, editorColumn, middleResizer, outlineWrapper, rightResizer, backlinksWrapper);

  // External file changes → re-seed the index (cheap for typical vaults).
  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  window.nexusDemo.onMenuAction((action) => {
    if (action === "save") {
      void handleSave();
    } else if (action === "saveAs") {
      void handleSaveAs();
    } else if (action === "open") {
      void handleOpen();
    }
  });

  window.nexusDemo.onOpenRecentFile(async (filePath) => {
    try {
      state.error = null;
      const result = await window.nexusDemo.openFileAtPath(filePath);
      if (!result) return;

      state.filePath = result.path;
      state.activeFile = result.path;
      shell.loadDocument(result.content);
      if (state.vaultPath && result.path.startsWith(state.vaultPath)) {
        vault.setActiveFile(result.path);
      }
      backlinks.refresh();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
    renderStatus();
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
