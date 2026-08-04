import "./styles/main.scss";
import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import {
  loadSettings,
  createSettingsPanel,
  applyShellColorScheme,
  type EditorSettings,
} from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { createGraphView, type GraphView } from "./graph-view";
import { openProjectSwitcher } from "./project-switcher";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";
import { iconEl } from "./icons";
import { installWindowChrome } from "./window-controls";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;
let vault: VaultPanel;
let backlinks: BacklinksPanel;
let graph: GraphView;

const linkIndex = new LinkIndex();
state.linkIndex = linkIndex;

/** Chrome title elements updated by renderStatus. */
let chromeFilename: HTMLElement | null = null;
let chromeDirty: HTMLElement | null = null;
let vaultToggleBtn: HTMLButtonElement | null = null;
let outlineToggleBtn: HTMLButtonElement | null = null;
let backlinksToggleBtn: HTMLButtonElement | null = null;
let graphToggleBtn: HTMLButtonElement | null = null;

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function createIconButton(
  name: Parameters<typeof iconEl>[0],
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nx-btn nx-btn--icon";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.appendChild(iconEl(name));
  btn.addEventListener("click", onClick);
  return btn;
}

function closeMenus(): void {
  document.querySelectorAll(".nx-menu").forEach((el) => el.remove());
}

function showFileMenu(anchor: HTMLElement): void {
  closeMenus();
  const menu = document.createElement("div");
  menu.className = "nx-menu";
  menu.setAttribute("role", "menu");

  const items: Array<{ label: string; kbd?: string; run: () => void; sep?: boolean }> = [
    { label: "Open file…", run: () => void handleOpen() },
    { label: "Save", kbd: "⌘S", run: () => void handleSave() },
    { label: "Save as…", run: () => void handleSaveAs() },
    { label: "Switch project…", kbd: "⌘⇧P", run: () => openSwitcher(), sep: true },
    { label: "Open vault…", run: () => void vault.promptPickVault() },
    { label: "Toggle backlinks", run: () => toggleBacklinks(), sep: true },
  ];

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "nx-menu__sep";
      menu.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nx-menu__item";
    btn.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.textContent = item.label;
    btn.appendChild(label);
    if (item.kbd) {
      const kbd = document.createElement("kbd");
      kbd.textContent = item.kbd;
      btn.appendChild(kbd);
    }
    btn.addEventListener("click", () => {
      closeMenus();
      item.run();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.right - menuRect.width;
  let top = rect.bottom + 6;
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 6;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      closeMenus();
      document.removeEventListener("mousedown", onOutside, true);
    }
  };
  requestAnimationFrame(() => document.addEventListener("mousedown", onOutside, true));
}

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("header");
  toolbar.className = "nx-chrome toolbar";

  const left = document.createElement("div");
  left.className = "nx-chrome__left";

  vaultToggleBtn = createIconButton("menu", "Toggle files sidebar", toggleVault);
  left.appendChild(vaultToggleBtn);

  const title = document.createElement("div");
  title.className = "nx-chrome__title";

  chromeFilename = document.createElement("span");
  chromeFilename.className = "nx-chrome__filename";
  chromeFilename.textContent = "Untitled";

  chromeDirty = document.createElement("span");
  chromeDirty.className = "nx-chrome__dirty";
  chromeDirty.title = "Unsaved changes";
  chromeDirty.setAttribute("aria-hidden", "true");

  title.append(chromeFilename, chromeDirty);

  const right = document.createElement("div");
  right.className = "nx-chrome__right";

  const searchBtn = createIconButton("search", "Search (Ctrl+F)", () => searchBar.open());
  outlineToggleBtn = createIconButton("outline", "Toggle outline", toggleOutline);
  backlinksToggleBtn = createIconButton("link", "Toggle backlinks", toggleBacklinks);
  graphToggleBtn = createIconButton("graph", "Knowledge graph (Ctrl+Shift+G)", toggleGraph);
  const moreBtn = createIconButton("more", "File actions", () => showFileMenu(moreBtn));
  const settingsBtn = createIconButton("settings", "Settings", handleSettings);

  right.append(searchBtn, outlineToggleBtn, backlinksToggleBtn, graphToggleBtn, moreBtn, settingsBtn);
  toolbar.append(left, title, right);
  // Platform chrome: drag region is CSS; Windows/Linux get min/max/close here.
  installWindowChrome(toolbar);
  return toolbar;
}

function createStatusLine(): HTMLElement {
  const status = document.createElement("div");
  status.className = "nx-status status-line";
  status.id = "status-line";

  const left = document.createElement("span");
  left.className = "nx-status__left";
  left.id = "status-left";

  const error = document.createElement("span");
  error.className = "nx-status__error";
  error.id = "status-error";

  const right = document.createElement("span");
  right.className = "nx-status__right";
  right.id = "status-right";

  status.append(left, error, right);
  return status;
}

function syncPanelToggleState(): void {
  if (vaultToggleBtn) {
    const vaultOpen =
      vault &&
      vault.element.style.display !== "none" &&
      !(typeof vault.isCollapsed === "function" && vault.isCollapsed());
    vaultToggleBtn.classList.toggle("is-active", !!vaultOpen);
  }
  if (outlineToggleBtn) {
    outlineToggleBtn.classList.toggle("is-active", outline?.element.style.display !== "none");
  }
  if (backlinksToggleBtn) {
    backlinksToggleBtn.classList.toggle("is-active", backlinks?.element.style.display !== "none");
  }
  if (graphToggleBtn) {
    graphToggleBtn.classList.toggle("is-active", !!graph?.isOpen());
  }
}

function renderStatus(): void {
  const path = state.activeFile ?? state.filePath;
  const name = path ? basename(path) : "Untitled";

  if (chromeFilename) chromeFilename.textContent = name;
  if (chromeDirty) chromeDirty.classList.toggle("is-dirty", state.dirty);

  const left = document.getElementById("status-left");
  const right = document.getElementById("status-right");
  const error = document.getElementById("status-error");
  if (!left || !right || !error) return;

  const dirtyMark = state.dirty ? " · modified" : "";
  const vaultName = state.vaultPath ? basename(state.vaultPath) : null;
  left.textContent = vaultName ? `${name}${dirtyMark} · ${vaultName}` : `${name}${dirtyMark}`;

  const stats = shell?.editor.getDocumentStats();
  right.textContent = stats ? `${stats.words} words · ${stats.lines} lines` : "";

  error.textContent = state.error ? state.error : "";
  error.style.display = state.error ? "" : "none";

  syncPanelToggleState();
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
    refreshDocumentPanels();
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
  });
}

function isPanelVisible(panel: HTMLElement): boolean {
  return panel.style.display !== "none";
}

function setPanelVisible(panel: HTMLElement, visible: boolean, onShow?: () => void): void {
  panel.style.display = visible ? "" : "none";
  if (visible) onShow?.();
  syncPanelToggleState();
}

function togglePanel(panel: HTMLElement, onShow?: () => void): void {
  setPanelVisible(panel, !isPanelVisible(panel), onShow);
}

function toggleOutline(): void {
  togglePanel(outline.element, () => outline.update());
}

function toggleVault(): void {
  // Prefer width-collapse when the vault panel supports it (keeps layout slot).
  if (vault && typeof vault.setCollapsed === "function") {
    const next = !vault.isCollapsed();
    vault.setCollapsed(next);
    // Also keep display in sync for first paint / legacy paths.
    vault.element.style.display = "";
    syncPanelToggleState();
    return;
  }
  togglePanel(vault.element);
}

function toggleBacklinks(): void {
  togglePanel(backlinks.element, () => backlinks.refresh());
}

function toggleGraph(): void {
  if (!graph) return;
  if (graph.isOpen()) graph.close();
  else graph.open();
  syncPanelToggleState();
}

function openSwitcher(): void {
  void openProjectSwitcher({
    // Reuse the wrapped openVault (updates state.vaultPath, reseeds the link
    // index, persists as last/recent) so switching behaves exactly like a
    // fresh open.
    onSwitch: (path) => void vault.openVault(path),
    onPickNew: () => void vault.promptPickVault(),
  });
}

/**
 * Refresh every panel derived from the active document. `shell.loadDocument`
 * loads files in silent mode (no `change` event, to avoid a redundant parse +
 * link-index rebuild on open), so panels that normally react to `change` —
 * the outline especially — must be poked by hand after a load. Keeping this in
 * one place stops the next document-derived panel from silently going stale.
 */
function refreshDocumentPanels(): void {
  outline.update();
  backlinks.refresh();
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

    const bl = perfStart("open-file.refresh-panels");
    refreshDocumentPanels();
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
  const bootScope = perfStart("boot");
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");
  root.classList.add("nx-app");

  // Apply persisted color scheme before first paint of chrome/panels.
  applyShellColorScheme(settings.colorScheme);

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
  graph = createGraphView({
    index: linkIndex,
    onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
    getActiveFile: () => state.activeFile,
  });

  // Default layout: vault + outline visible; backlinks hidden (Notion/语雀-like).
  vault.element.style.display = "";
  outline.element.style.display = "";
  backlinks.element.style.display = "none";

  editorColumn.append(searchBar.element, editorContainer, graph.element);
  mainArea.append(vault.element, editorColumn, outline.element, backlinks.element);

  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "f") {
      e.preventDefault();
      searchBar.open();
    }
    if (meta && e.key === "s") {
      e.preventDefault();
      void handleSave();
    }
    if (meta && e.shiftKey && (e.key === "g" || e.key === "G")) {
      e.preventDefault();
      toggleGraph();
    }
    if (meta && e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      openSwitcher();
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
