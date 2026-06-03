import { 
  getState, 
  setFilePath, 
  setActiveFile, 
  setContent, 
  setDirty, 
  setError, 
  getEditor 
} from '../store/editorStore';

const VAULT_STORAGE_KEY = "nexus-web-vault";

function isVaultFile(filePath: string): boolean {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) {
      const storage = JSON.parse(raw);
      return Object.keys(storage.files).includes(filePath);
    }
  } catch {
    /* ignore */
  }
  return false;
}

function saveToVault(filePath: string, content: string): void {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    const storage = raw ? JSON.parse(raw) : { files: {}, vaultName: "My Vault" };
    storage.files[filePath] = content;
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(storage));
  } catch (err) {
    console.error('Failed to save to vault:', err);
  }
}

export async function handleOpen(): Promise<void> {
  try {
    setError(null);
    const state = getState();
    
    if (state.dirty) {
      if (!window.confirm('You have unsaved changes. Discard them and open a new file?')) {
        return;
      }
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const content = await file.text();
      setFilePath(file.name);
      setActiveFile(file.name);
      getEditor()?.setDocument(content);
      setContent(content);
      setDirty(false);
    };
    input.click();
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}

export async function handleSave(): Promise<void> {
  try {
    setError(null);
    const state = getState();
    
    if (!state.filePath) {
      await handleSaveAs();
      return;
    }
    
    if (isVaultFile(state.filePath)) {
      saveToVault(state.filePath, state.content);
      setDirty(false);
    } else {
      const blob = new Blob([state.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.filePath;
      a.click();
      URL.revokeObjectURL(url);
      
      setDirty(false);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}

export async function handleSaveAs(): Promise<void> {
  try {
    setError(null);
    const state = getState();
    
    const blob = new Blob([state.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.filePath || 'untitled.md';
    a.click();
    URL.revokeObjectURL(url);
    
    setDirty(false);
    if (!state.filePath) {
      setFilePath('untitled.md');
      setActiveFile('untitled.md');
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}