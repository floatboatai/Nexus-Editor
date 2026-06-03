export interface EditorState {
  filePath: string | null;
  content: string;
  dirty: boolean;
  error: string | null;
  activeFile: string | null;
}

export interface NexusEditor extends HTMLElement {
  value: string;
  setDocument(value: string, options?: { silent?: boolean }): void;
  getDocument(): string;
  setSelection(anchor: number, head?: number): void;
  focus(): void;
  undo(): boolean;
  redo(): boolean;
  setAttribute(name: string, value: string): void;
  getEditorAPI(): unknown;
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'nexus-editor': NexusEditor;
  }
}
