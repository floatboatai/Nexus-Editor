import type { EditorState, NexusEditor } from '../types';

const state: EditorState = {
  filePath: null,
  content: '',
  dirty: false,
  error: null,
  activeFile: null
};

let editorInstance: NexusEditor | null = null;

export function getState(): EditorState {
  return { ...state };
}

export function setFilePath(path: string | null): void {
  state.filePath = path;
}

export function setActiveFile(file: string | null): void {
  state.activeFile = file;
}

export function setContent(content: string): void {
  state.content = content;
}

export function setDirty(dirty: boolean): void {
  state.dirty = dirty;
}

export function setError(error: string | null): void {
  state.error = error;
}

export function getEditor(): NexusEditor | null {
  return editorInstance;
}

export function setEditor(editor: NexusEditor): void {
  editorInstance = editor;
}

export function updateContentFromEditor(): void {
  if (editorInstance) {
    state.content = editorInstance.value;
  }
}
