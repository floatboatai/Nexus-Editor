import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";
import { createVaultPanel, type VaultPanel } from "./vault-panel";
import { LinkIndex, parseAnchor, findAnchorPosition } from "./link-index";
import { createBacklinksPanel, type BacklinksPanel } from "./backlinks-panel";
import { createAskWikiPanel, type AskWikiPanel } from "./ask-wiki-panel";
import { createLLMWikiQueuePanel, type LLMWikiQueuePanel } from "./llm-wiki-queue-panel";
import { perfStart, perfEnd, installLongTaskWatch } from "./perf";

installLongTaskWatch(50);

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;
let vault: VaultPanel;
let backlinks: BacklinksPanel;
let askWiki: AskWikiPanel;
let llmWikiQueue: LLMWikiQueuePanel;
let llmWikiState: LLMWikiStateFile | null = null;
let llmWikiStatus: LLMWikiStatus | null = null;
let llmWikiProjectPath: string | null = null;

const linkIndex = new LinkIndex();
state.linkIndex = linkIndex;

function unavailableInBrowser(): Error {
  return new Error("This action requires the Electron desktop app.");
}

function ensureBrowserBridge(): void {
  if (window.nexusDemo) return;

  window.nexusDemo = {
    openFile: async () => null,
    saveFile: async () => {
      throw unavailableInBrowser();
    },
    saveFileAs: async () => null,
    vault: {
      pick: async () => null,
      list: async () => [],
      read: async () => {
        throw unavailableInBrowser();
      },
      readAll: async () => [],
      write: async () => {
        throw unavailableInBrowser();
      },
      createFile: async () => {
        throw unavailableInBrowser();
      },
      createFolder: async () => {
        throw unavailableInBrowser();
      },
      rename: async () => {
        throw unavailableInBrowser();
      },
      delete: async () => {
        throw unavailableInBrowser();
      },
      getLast: async () => ({ lastVault: null, recents: [] }),
      setLast: async () => ({ ok: false }),
      onChanged: () => () => {},
    },
    llmWiki: {
      saveSource: async () => {
        throw unavailableInBrowser();
      },
      getStatus: async () => null,
      getDocStatuses: async () => ({
        projectPath: "",
        state: {
          version: 1,
          mode: "manual",
          documents: {},
          projectIssues: [],
        },
      }),
      submitDoc: async () => {
        throw unavailableInBrowser();
      },
      submitAllDirty: async () => {
        throw unavailableInBrowser();
      },
      retryFailed: async () => {
        throw unavailableInBrowser();
      },
      getSubmitMode: async () => ({ projectPath: "", mode: "manual" }),
      setSubmitMode: async (mode) => ({ projectPath: "", mode }),
      getConfigStatus: async () => ({
        provider: "fixture",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKeyConfigured: false,
        envPath: "Electron desktop app",
      }),
      saveConfig: async () => {
        throw unavailableInBrowser();
      },
      ask: async () => {
        throw unavailableInBrowser();
      },
      openSchema: async () => {
        throw unavailableInBrowser();
      },
      onStatus: () => () => {},
      onDocStatus: () => () => {},
    },
  };
}

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

  const askWikiBtn = document.createElement("button");
  askWikiBtn.textContent = "Ask";
  askWikiBtn.title = "Ask the current LLM Wiki";
  askWikiBtn.addEventListener("click", () => askWiki.toggle());

  const queueBtn = document.createElement("button");
  queueBtn.textContent = "Queue";
  queueBtn.title = "LLM Wiki submission queue";
  queueBtn.addEventListener("click", () => llmWikiQueue.toggle());

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "\u2699"; // gear
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
    askWikiBtn,
    queueBtn,
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
  const llmWikiText = llmWikiStatus ? ` | ${formatLLMWikiStatus(llmWikiStatus)}` : "";
  const docStatusText = formatLLMWikiDocumentSummary();
  el.textContent = `${pathLabel}${dirtyMark}${statsText}${vaultLabel}${llmWikiText}${docStatusText}${errorText}`;
}

function formatLLMWikiStatus(status: LLMWikiStatus): string {
  if (status.state === "running") return "LLM Wiki: compiling...";
  if (status.state === "succeeded") return "LLM Wiki: ok";
  if (status.state === "failed") {
    return `LLM Wiki: failed: ${shortStatusMessage(status.message ?? status.result?.error ?? "unknown")}`;
  }
  return "LLM Wiki: queued";
}

function formatLLMWikiDocumentSummary(): string {
  if (!llmWikiState) return "";
  const docs = Object.values(llmWikiState.documents);
  if (docs.length === 0) return "";
  const count = (status: LLMWikiDocumentStatusState) => docs.filter((doc) => doc.status === status).length;
  const parts = [
    `${count("dirty")} dirty`,
    `${count("queued")} queued`,
    `${count("submitting")} submitting`,
    `${count("failed")} failed`,
    `${count("parsed")} parsed`,
    `${docs.length} total`,
  ];
  return ` | LLM Wiki docs: ${parts.join(", ")}`;
}

function shortStatusMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function rawPathRelativeToVault(filePath: string): string | null {
  const project = state.vaultPath;
  if (!project) return null;
  const normalizedFile = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedProject = project.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedFile !== normalizedProject && !normalizedFile.startsWith(`${normalizedProject}/`)) {
    return null;
  }
  const rel = normalizedFile === normalizedProject
    ? ""
    : normalizedFile.slice(normalizedProject.length + 1);
  return rel.startsWith("raw/") ? rel : null;
}

function rawStatusForFile(filePath: string): LLMWikiDocumentStatus | null {
  if (!llmWikiState) return null;
  const rel = rawPathRelativeToVault(filePath);
  return rel ? llmWikiState.documents[rel] ?? null : null;
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function sameProjectPath(left: string | null, right: string): boolean {
  return left !== null && normalizeProjectPath(left) === normalizeProjectPath(right);
}

function isCurrentLLMWikiProject(projectPath: string): boolean {
  if (llmWikiProjectPath && !sameProjectPath(llmWikiProjectPath, projectPath)) return false;
  if (state.vaultPath && !sameProjectPath(state.vaultPath, projectPath)) return false;
  return true;
}

function acceptsLLMWikiStatusProject(projectPath: string): boolean {
  if (llmWikiProjectPath) return sameProjectPath(llmWikiProjectPath, projectPath);
  if (state.vaultPath) return sameProjectPath(state.vaultPath, projectPath);
  return true;
}

function updateLLMWikiDocumentState(projectPath: string, nextState: LLMWikiStateFile | null): void {
  llmWikiProjectPath = projectPath;
  if (llmWikiStatus && !sameProjectPath(projectPath, llmWikiStatus.projectPath)) {
    llmWikiStatus = null;
  }
  llmWikiState = nextState;
  llmWikiQueue.update(llmWikiState);
  renderStatus();
  void vault.refresh();
}

function clearLLMWikiDocumentState(projectPath: string | null): void {
  llmWikiProjectPath = projectPath;
  llmWikiStatus = null;
  llmWikiState = null;
  llmWikiQueue.update(null);
  renderStatus();
  void vault.refresh();
}

async function refreshLLMWikiDocumentStatuses(): Promise<void> {
  try {
    const payload = await window.nexusDemo.llmWiki.getDocStatuses();
    if (!isCurrentLLMWikiProject(payload.projectPath)) return;
    updateLLMWikiDocumentState(payload.projectPath, payload.state);
  } catch (err) {
    console.warn("Could not read LLM Wiki document statuses:", err);
  }
}

function activeRawPath(): string | null {
  const active = state.activeFile ?? state.filePath;
  return active ? rawPathRelativeToVault(active) : null;
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
    const result = await window.nexusDemo.llmWiki.saveSource({
      content: state.content,
      currentPath: state.activeFile ?? state.filePath,
    });

    state.filePath = result.savedPath;
    state.activeFile = result.savedPath;
    state.vaultPath = result.projectPath;
    state.dirty = false;

    if (vault.getVaultPath() !== result.projectPath) {
      await vault.openVault(result.projectPath);
    } else {
      await vault.refresh();
    }
    vault.setActiveFile(result.savedPath);
    linkIndex.updateFile(result.savedPath, state.content);
    backlinks.refresh();
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
  createSettingsPanel(
    settings,
    (next) => {
      settings = next;
      shell.applySettings(settings);
    },
    {
      getConfigStatus: () => window.nexusDemo.llmWiki.getConfigStatus(),
      saveConfig: (input) => window.nexusDemo.llmWiki.saveConfig(input),
      getSubmitMode: () => window.nexusDemo.llmWiki.getSubmitMode(),
      setSubmitMode: (mode) => window.nexusDemo.llmWiki.setSubmitMode(mode),
      openSchema: async () => {
        if (!(await confirmDiscardIfDirty())) return;
        const result = await window.nexusDemo.llmWiki.openSchema({ projectPath: state.vaultPath });
        state.vaultPath = result.projectPath;
        if (vault.getVaultPath() !== result.projectPath) {
          await vault.openVault(result.projectPath);
        } else {
          await vault.refresh();
        }
        shell.loadDocument(result.content);
        state.filePath = result.schemaPath;
        state.activeFile = result.schemaPath;
        state.dirty = false;
        vault.setActiveFile(result.schemaPath);
        renderStatus();
      },
    }
  );
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

function handleLLMWikiStatus(status: LLMWikiStatus): void {
  if (!acceptsLLMWikiStatusProject(status.projectPath)) return;
  llmWikiStatus = status;
  renderStatus();
  if (status.state !== "succeeded") return;

  void (async () => {
    await vault.refresh();
    await seedLinkIndex();
    backlinks.refresh();
    renderStatus();
  })().catch((err) => {
    state.error = err instanceof Error ? err.message : String(err);
    renderStatus();
  });
}

function boot(): void {
  ensureBrowserBridge();

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
    getLLMWikiRawStatus: rawStatusForFile,
  });

  // Keep state in sync when the vault panel picks a new vault.
  const originalOpenVault = vault.openVault;
  vault.openVault = async (nextPath: string) => {
    await originalOpenVault(nextPath);
    state.vaultPath = nextPath;
    clearLLMWikiDocumentState(nextPath);
    renderStatus();
    // Index in the background — don't block the editor on it.
    void seedLinkIndex();
    void refreshLLMWikiDocumentStatuses();
  };

  outline = createOutlinePanel(shell.editor);
  searchBar = createSearchBar(shell.editor);
  backlinks = createBacklinksPanel({
    index: linkIndex,
    onOpenFile: (filePath) => void handleVaultFileOpen(filePath),
    getActiveFile: () => state.activeFile,
  });
  askWiki = createAskWikiPanel({
    getProjectPath: () => state.vaultPath,
    ask: (input) => window.nexusDemo.llmWiki.ask(input),
    onError: (message) => {
      state.error = message;
      renderStatus();
    },
  });
  llmWikiQueue = createLLMWikiQueuePanel({
    getActiveRawPath: activeRawPath,
    getState: () => llmWikiState,
    submitCurrent: async (rawPath) => {
      await window.nexusDemo.llmWiki.submitDoc({ rawPath });
      await refreshLLMWikiDocumentStatuses();
    },
    submitAllDirty: async () => {
      await window.nexusDemo.llmWiki.submitAllDirty();
      await refreshLLMWikiDocumentStatuses();
    },
    retryFailed: async () => {
      await window.nexusDemo.llmWiki.retryFailed();
      await refreshLLMWikiDocumentStatuses();
    },
    openSchema: async () => {
      if (!(await confirmDiscardIfDirty())) return;
      const result = await window.nexusDemo.llmWiki.openSchema({ projectPath: state.vaultPath });
      state.vaultPath = result.projectPath;
      if (vault.getVaultPath() !== result.projectPath) {
        await vault.openVault(result.projectPath);
      } else {
        await vault.refresh();
      }
      shell.loadDocument(result.content);
      state.filePath = result.schemaPath;
      state.activeFile = result.schemaPath;
      state.dirty = false;
      vault.setActiveFile(result.schemaPath);
      renderStatus();
    },
    onError: (message) => {
      state.error = message;
      renderStatus();
    },
  });

  editorColumn.append(searchBar.element, editorContainer);
  mainArea.append(vault.element, editorColumn, outline.element, backlinks.element, askWiki.element, llmWikiQueue.element);

  // External file changes → re-seed the index (cheap for typical vaults).
  window.nexusDemo.vault.onChanged(() => {
    void seedLinkIndex();
  });

  window.nexusDemo.llmWiki.onStatus(handleLLMWikiStatus);
  void window.nexusDemo.llmWiki
    .getStatus()
    .then((status) => {
      if (status) handleLLMWikiStatus(status);
    })
    .catch((err) => {
      console.warn("Could not read LLM Wiki status:", err);
    });
  void refreshLLMWikiDocumentStatuses();

  window.nexusDemo.llmWiki.onDocStatus((payload) => {
    if (!isCurrentLLMWikiProject(payload.projectPath)) return;
    llmWikiProjectPath = payload.projectPath;
    if (!llmWikiState) {
      llmWikiState = { version: 1, mode: "manual", documents: {}, projectIssues: [] };
    }
    llmWikiState.documents[payload.rawPath] = payload.status;
    llmWikiQueue.update(llmWikiState);
    renderStatus();
    void vault.refresh();
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
