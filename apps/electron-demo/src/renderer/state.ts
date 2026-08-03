import type { LinkIndex } from "./link-index";

export interface AppState {
  filePath: string | null;
  /** Latest editor buffer observed by the renderer. */
  content: string;
  /** Exact snapshot last loaded from or successfully written to disk. */
  savedContent: string;
  dirty: boolean;
  error: string | null;
  vaultPath: string | null;
  vaultTree: VaultNode[];
  activeFile: string | null;
  linkIndex: LinkIndex | null;
}

export function createState(): AppState {
  return {
    filePath: null,
    content: "",
    savedContent: "",
    dirty: false,
    error: null,
    vaultPath: null,
    vaultTree: [],
    activeFile: null,
    linkIndex: null,
  };
}

/** Sync a debounced editor change without losing the persisted baseline. */
export function syncEditorContent(state: AppState, content: string): void {
  state.content = content;
  state.dirty = content !== state.savedContent;
}

/** Reset the persisted baseline after loading a document from disk. */
export function markContentLoaded(state: AppState, content: string): void {
  state.savedContent = content;
  syncEditorContent(state, content);
}

/**
 * Record the snapshot that finished saving, then compare it with the live
 * buffer. The two may differ when the user keeps typing during file I/O.
 */
export function markContentSaved(
  state: AppState,
  savedContent: string,
  currentContent: string
): void {
  state.savedContent = savedContent;
  syncEditorContent(state, currentContent);
}

/** Include edits that have not reached the debounced onChange callback yet. */
export function hasUnsavedChanges(state: AppState, currentContent: string): boolean {
  return currentContent !== state.savedContent;
}
