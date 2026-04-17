import { createState, type AppState } from "./state";
import { createEditorShell, type EditorShell } from "./editor-shell";
import { loadSettings, createSettingsPanel, type EditorSettings } from "./settings";
import { createOutlinePanel, type OutlinePanel } from "./outline-panel";
import { createSearchBar, type SearchBar } from "./search-bar";

const state: AppState = createState();
let settings: EditorSettings = loadSettings();
let shell: EditorShell;
let outline: OutlinePanel;
let searchBar: SearchBar;

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

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

  const outlineBtn = document.createElement("button");
  outlineBtn.textContent = "\u2630"; // ☰
  outlineBtn.title = "Toggle outline";
  outlineBtn.style.fontSize = "14px";
  outlineBtn.addEventListener("click", toggleOutline);

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

  toolbar.append(openBtn, saveBtn, saveAsBtn, spacer, outlineBtn, searchBtn, settingsBtn);
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

  const pathLabel = state.filePath ?? "Untitled";
  const dirtyMark = state.dirty ? " [modified]" : "";
  const stats = shell?.editor.getDocumentStats();
  const statsText = stats ? ` | ${stats.words} words, ${stats.lines} lines` : "";
  const errorText = state.error ? ` — Error: ${state.error}` : "";
  el.textContent = `${pathLabel}${dirtyMark}${statsText}${errorText}`;
}

async function handleOpen(): Promise<void> {
  try {
    state.error = null;
    const result = await window.nexusDemo.openFile();
    if (!result) return;

    state.filePath = result.path;
    shell.loadDocument(result.content);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  renderStatus();
}

async function handleSave(): Promise<void> {
  try {
    state.error = null;
    if (state.filePath) {
      await window.nexusDemo.saveFile(state.filePath, state.content);
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
    state.dirty = false;
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

function toggleOutline(): void {
  const panel = outline.element;
  if (panel.style.display === "none") {
    panel.style.display = "";
    outline.update();
  } else {
    panel.style.display = "none";
  }
}

function boot(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app element");

  // Top bar
  const appToolbar = createAppToolbar();
  const statusLine = createStatusLine();

  // Main area: outline sidebar + editor column
  const mainArea = document.createElement("div");
  mainArea.className = "main-area";

  const editorColumn = document.createElement("div");
  editorColumn.className = "editor-column";

  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";

  root.append(appToolbar, mainArea, statusLine);

  // Create editor first so outline/search can reference it
  shell = createEditorShell({
    container: editorContainer,
    state,
    settings,
    onStateChange: renderStatus,
  });

  // Outline panel (left sidebar)
  outline = createOutlinePanel(shell.editor);

  // Search bar (above editor)
  searchBar = createSearchBar(shell.editor);

  editorColumn.append(searchBar.element, editorContainer);
  mainArea.append(outline.element, editorColumn);

  // Ctrl+F → open search
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      searchBar.open();
    }
  });

  renderStatus();
}

boot();
