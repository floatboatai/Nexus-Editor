import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { openSearchPanelIn } from "@floatboat/nexus-plugin-search";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let vault: VaultPanel;
let backlinks: BacklinksPanel;

const linkIndex = new LinkIndex();
state.linkIndex = linkIndex;

let appTooltipId = 0;

const TOOLTIP_VIEWPORT_MARGIN = 8;

function positionAppToolbarTooltip(
  tooltip: HTMLElement,
  button: HTMLButtonElement
): void {
  const rect = button.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + 6}px`;
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.transform = "translateX(-50%)";

  const tipRect = tooltip.getBoundingClientRect();
  const maxRight = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN;
  if (tipRect.right > maxRight) {
    const shift = tipRect.right - maxRight;
    tooltip.style.left = `${rect.left + rect.width / 2 - shift}px`;
  }

  const adjusted = tooltip.getBoundingClientRect();
  if (adjusted.left < TOOLTIP_VIEWPORT_MARGIN) {
    const shift = TOOLTIP_VIEWPORT_MARGIN - adjusted.left;
    const currentLeft = parseFloat(tooltip.style.left);
    tooltip.style.left = `${currentLeft + shift}px`;
  }
}

function installAppToolbarTooltip(button: HTMLButtonElement, label: string): void {
  button.title = "";
  button.setAttribute("aria-label", label);

  const tooltip = document.createElement("div");
  tooltip.className = "app-toolbar-tooltip";
  tooltip.id = `app-toolbar-tooltip-${++appTooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  button.setAttribute("aria-describedby", tooltip.id);

  const show = () => {
    tooltip.textContent = label;
    if (!tooltip.isConnected) {
      document.body.appendChild(tooltip);
    }
    positionAppToolbarTooltip(tooltip, button);
  };
  const hide = () => {
    tooltip.remove();
  };
  const updatePosition = () => {
    if (!tooltip.isConnected) {
      return;
    }
    positionAppToolbarTooltip(tooltip, button);
  };

  button.addEventListener("mouseenter", show);
  button.addEventListener("focus", show);
  button.addEventListener("mouseleave", hide);
  button.addEventListener("blur", hide);
  button.addEventListener("click", hide);
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);
}

function createTextToolbarButton(
  label: string,
  onClick: () => void,
  tooltip?: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toolbar-text-btn";
  button.textContent = label;
  if (tooltip) {
    button.title = tooltip;
  }
  button.addEventListener("click", onClick);
  return button;
}

function createIconToolbarButton(
  icon: string,
  label: string,
  onClick: () => void,
  large = false
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = large ? "toolbar-icon-btn toolbar-icon-btn--lg" : "toolbar-icon-btn";
  button.textContent = icon;
  button.addEventListener("click", onClick);
  installAppToolbarTooltip(button, label);
  return button;
}

function createAppToolbar(onSearch: () => void): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const fileActions = document.createElement("div");
  fileActions.className = "toolbar-actions";
  fileActions.append(
    createTextToolbarButton("Vault", () => {
      void vault.promptPickVault();
    }, "Open a folder as a vault"),
    createTextToolbarButton("New", () => {
      void handleNew();
    }, "New untitled document"),
    createTextToolbarButton("Open", () => {
      void handleOpen();
    }, "Open file"),
    createTextToolbarButton("Save", () => {
      void handleSave();
    }, "Save (Ctrl+S)"),
    createTextToolbarButton("Save As", () => {
      void handleSaveAs();
    }, "Save as")
  );

  const spacer = document.createElement("div");
  spacer.className = "toolbar-spacer";

  const panelActions = document.createElement("div");
  panelActions.className = "toolbar-actions toolbar-actions--icons";
  panelActions.append(
    createIconToolbarButton("\uD83D\uDCD1", "Toggle vault panel", toggleVault),
    createIconToolbarButton("\u2630", "Toggle outline", toggleOutline),
    createIconToolbarButton("\uD83D\uDD17", "Toggle backlinks", toggleBacklinks),
    createIconToolbarButton("\uD83D\uDD0D", "Find in document (Ctrl+F)", onSearch),
    createIconToolbarButton("\u2699", "Editor settings", handleSettings, true)
  );

  toolbar.append(fileActions, spacer, panelActions);
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

async function handleNew(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  state.error = null;
  state.activeFile = null;
  state.filePath = null;
  vault.setActiveFile(null);
  shell.loadDocument("");
  void backlinks?.refresh();
  void outline?.update();
  renderStatus();
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
    state.content = shell.editor.getDocument();
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
    state.content = shell.editor.getDocument();
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

  const statusLine = createStatusLine();

  const mainArea = document.createElement("div");
  mainArea.className = "main-area";

  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";

  const openSearch = () => {
    openSearchPanelIn(editorContainer);
  };

  const appToolbar = createAppToolbar(openSearch);
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

  const clearActiveFile = (): void => {
    // Close the document view without touching filesystem contents.
    state.error = null;
    state.activeFile = null;
    state.filePath = null;
    // Keep vault tree selection in sync and reset editor content.
    vault.setActiveFile(null);
    shell.loadDocument("");
    void backlinks?.refresh();
    void outline?.update();
    renderStatus();
  };

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
    onClearActiveFile: clearActiveFile,
    onVaultOpened: (nextPath) => {
      state.vaultPath = nextPath;
      renderStatus();
      void seedLinkIndex();
    },
    onVaultClosed: () => {
      state.vaultPath = null;
      linkIndex.rebuild([]);
      if (state.activeFile) {
        vault.setActiveFile(state.activeFile);
      }
      renderStatus();
      void backlinks?.refresh();
    },
  });

  outline = createOutlinePanel(shell.editor);
  backlinks = createBacklinksPanel({
    index: linkIndex,
    onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
    getActiveFile: () => state.activeFile,
  });
  outline.element.style.display = "none";
  backlinks.element.style.display = "none";

  editorColumn.append(editorContainer);
  mainArea.append(vault.element, editorColumn, outline.element, backlinks.element);

  // External file changes → re-seed the index (cheap for typical vaults).
  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) {
      return;
    }
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (e.shiftKey) {
        void handleSaveAs();
      } else {
        void handleSave();
      }
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
