import { getEditor } from '../store/editorStore';
import { createSearchBar, type SearchBar } from '../components/SearchBar';
import { createSettingsPanel } from '../components/SettingsPanel';

let searchBar: SearchBar | null = null;
let settingsPanel: ReturnType<typeof createSettingsPanel> | null = null;

export function handleUndo(): void {
  getEditor()?.undo();
}

export function handleRedo(): void {
  getEditor()?.redo();
}

export function handleSearch(): void {
  const editor = getEditor();
  if (!editor) return;

  const editorAPI = editor.getEditorAPI();
  if (!editorAPI) return;

  if (!searchBar) {
    searchBar = createSearchBar(editorAPI as any);
    const editorColumn = document.querySelector('.editor-column');
    if (editorColumn) {
      editorColumn.insertBefore(searchBar.element, editorColumn.firstChild);
    }
  }

  searchBar.open();
}

export function handleSettings(): void {
  const editor = getEditor();
  if (!editor) return;

  const editorAPI = editor.getEditorAPI();
  if (!editorAPI) return;

  if (!settingsPanel) {
    settingsPanel = createSettingsPanel(editorAPI as any);
    document.body.appendChild(settingsPanel.element);
  }

  settingsPanel.open();
}