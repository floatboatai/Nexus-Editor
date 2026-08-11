import type { AppState } from "./state";

export interface DocumentLoadShell {
  loadDocument(content: string): void;
}

export interface DocumentLoadFile {
  path: string;
  content: string;
}

export function loadDocumentIntoEditor(options: {
  state: AppState;
  shell: DocumentLoadShell | null;
  file: DocumentLoadFile;
}): void {
  const { state, shell, file } = options;
  if (!shell) {
    throw new Error("Editor is still starting. Try opening the file again in a moment.");
  }

  shell.loadDocument(file.content);
  state.filePath = file.path;
  state.activeFile = file.path;
}
