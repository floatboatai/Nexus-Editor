import '@floatboat/nexus-webcomponent';
import './types';
import { createEditor } from './components/Editor';
import { createVaultPanel, type VaultPanel } from './components/VaultPanel';
import { createOutlinePanel, type OutlinePanel } from './components/OutlinePanel';
import { createBacklinksPanel, type BacklinksPanel } from './components/BacklinksPanel';
import { 
  handleOpen, 
  handleSave, 
  handleSaveAs, 
  handleSearch, 
  handleSettings,
  setupKeyboardShortcuts 
} from './commands';
import { setFilePath, setActiveFile, setContent, setDirty, getState } from './store/editorStore';
import { getEditor } from './store/editorStore';

let vault: VaultPanel | null = null;
let outline: OutlinePanel | null = null;
let backlinks: BacklinksPanel | null = null;

const VAULT_STORAGE_KEY = "nexus-web-vault";

function getFileContent(filePath: string): string | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) {
      const storage = JSON.parse(raw);
      return storage.files[filePath] || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function togglePanel(panel: HTMLElement | null, onShow?: () => void): void {
  if (!panel) return;
  if (panel.style.display === "none") {
    panel.style.display = "";
    onShow?.();
  } else {
    panel.style.display = "none";
  }
}

function setupEventListeners(): void {
  document.getElementById('openBtn')?.addEventListener('click', handleOpen);
  document.getElementById('saveBtn')?.addEventListener('click', handleSave);
  document.getElementById('saveAsBtn')?.addEventListener('click', handleSaveAs);
  document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
  document.getElementById('settingsBtn')?.addEventListener('click', handleSettings);
  
  document.getElementById('vaultToggleBtn')?.addEventListener('click', () => {
    togglePanel(vault?.element || null);
  });
  
  document.getElementById('outlineToggleBtn')?.addEventListener('click', () => {
    togglePanel(outline?.element || null, () => outline?.update());
  });
  
  document.getElementById('backlinksToggleBtn')?.addEventListener('click', () => {
    togglePanel(backlinks?.element || null, () => backlinks?.refresh());
  });
}

function refreshPanels(): void {
  outline?.update();
  backlinks?.refresh();
}

function handleVaultFileOpen(filePath: string): void {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) {
      const storage = JSON.parse(raw);
      const content = storage.files[filePath] || "";
      
      const editor = getEditor();
      if (editor) {
        editor.setDocument(content, { silent: true });
      }
      
      setFilePath(filePath);
      setActiveFile(filePath);
      setContent(content);
      setDirty(false);
      
      if (vault) {
        vault.setActiveFile(filePath);
      }
      
      refreshPanels();
    }
  } catch (err) {
    console.error('Failed to open file:', err);
  }
}

function handleVaultError(message: string): void {
  console.error('Vault error:', message);
}

function handleVaultStatus(message: string): void {
  console.log('Vault status:', message);
}

function boot(): void {
  const container = document.getElementById('editorContainer');
  if (!container) throw new Error('Missing editor container');
  
  const mainArea = document.querySelector('.main-area');
  if (!mainArea) throw new Error('Missing main area');
  
  const editorColumn = document.querySelector('.editor-column');
  if (!editorColumn) throw new Error('Missing editor column');
  
  const editorInstance = createEditor(container);
  const nexusEditor = editorInstance.element;
  
  vault = createVaultPanel({
    onOpenFile: handleVaultFileOpen,
    onError: handleVaultError,
    onStatus: handleVaultStatus,
  });
  
  const editorAPI = nexusEditor.getEditorAPI?.();
  if (editorAPI) {
    outline = createOutlinePanel(editorAPI as any);
  }
  
  backlinks = createBacklinksPanel({
    onOpenFile: handleVaultFileOpen,
    getActiveFile: () => getState().activeFile,
    getFileContent,
  });
  
  mainArea.insertBefore(vault.element, editorColumn);
  if (outline) {
    mainArea.appendChild(outline.element);
  }
  mainArea.appendChild(backlinks.element);
  
  setupEventListeners();
  setupKeyboardShortcuts();
  
  const editor = getEditor();
  if (editor) {
    editor.addEventListener('change', refreshPanels);
  }
}

boot();