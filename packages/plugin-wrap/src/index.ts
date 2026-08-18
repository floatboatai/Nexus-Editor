import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

import {
  configureStorage,
  getWrapForFile,
  setWrapForFile,
  renameWrapForPath,
  resolveWrapForFile,
} from "./wrap-state";
import { createWrapToggle, type WrapToggle } from "./wrap-toggle";

export { createWrapToggle, type WrapToggle } from "./wrap-toggle";
export {
  configureStorage,
  getWrapForFile,
  setWrapForFile,
  clearWrapForFile,
  clearAllWrapState,
  renameWrapForPath,
  resolveWrapForFile,
} from "./wrap-state";

export interface WrapPluginOptions {
  defaultWrap?: boolean;
  storageKey?: string;
  hotkey?: string | null;
  commandId?: string;
  commandLabel?: string;
  name?: string;
}

export interface WrapPluginHandle {
  readonly plugin: NexusPlugin;
  attach(editor: EditorAPI, container: HTMLElement): void;
  detach(): void;
  toggleCurrentFile(): void;
  setCurrentFileWrap(enabled: boolean): void;
  setActiveFilePath(path: string | null): void;
  setDefaultWrap(enabled: boolean): void;
  getDefaultWrap(): boolean;
  renamePath(oldPath: string, newPath: string): void;
  carryStateToNewFile(newFilePath: string): void;
  isEnabled(): boolean;
  getActiveFilePath(): string | null;
  onChange(cb: (enabled: boolean) => void): () => void;
  dispose(): void;
}

const DEFAULT_HOTKEY = "Alt-z";
const DEFAULT_COMMAND_ID = "nexus.wrap.toggle";
const DEFAULT_COMMAND_LABEL = "Toggle word wrap";
const DEFAULT_PLUGIN_NAME = "nexus-plugin-wrap";

export function createWrapPlugin(options: WrapPluginOptions = {}): WrapPluginHandle {
  const {
    defaultWrap = false,
    storageKey,
    hotkey = DEFAULT_HOTKEY,
    commandId = DEFAULT_COMMAND_ID,
    commandLabel = DEFAULT_COMMAND_LABEL,
    name = DEFAULT_PLUGIN_NAME,
  } = options;

  if (storageKey) configureStorage(storageKey);

  let defaultWrapState = defaultWrap;
  let editorRef: EditorAPI | null = null;
  let containerRef: HTMLElement | null = null;
  let toggle: WrapToggle | null = null;
  let activeFilePath: string | null = null;
  const listeners = new Set<(enabled: boolean) => void>();

  const notify = (enabled: boolean) => {
    for (const cb of listeners) {
      try {
        cb(enabled);
      } catch {
        // ignore
      }
    }
  };

  const ensureToggle = (): WrapToggle | null => {
    if (!editorRef || !containerRef) return null;
    if (!toggle) {
      const initial = resolveWrapForFile(activeFilePath, defaultWrapState);
      toggle = createWrapToggle(editorRef, containerRef, initial);
    }
    return toggle;
  };

  const handle: WrapPluginHandle = {
    plugin: {
      name,
      commands: [
        {
          id: commandId,
          label: commandLabel,
          hotkey: hotkey ?? undefined,
          run: (editor) => {
            if (editorRef !== editor && !containerRef) return false;
            ensureToggle();
            handle.toggleCurrentFile();
            return true;
          },
        },
      ],
    },

    attach(editor, container) {
      if (editorRef === editor && containerRef === container && toggle) return;
      if (toggle) {
        toggle.dispose();
        toggle = null;
      }
      editorRef = editor;
      containerRef = container;
      ensureToggle();
    },

    detach() {
      if (toggle) {
        toggle.dispose();
        toggle = null;
      }
      editorRef = null;
      containerRef = null;
    },

    toggleCurrentFile() {
      const t = ensureToggle();
      if (!t) return;
      const next = !t.isEnabled();
      setWrapForFile(activeFilePath, next);
      t.setEnabled(next);
      notify(next);
    },

    setCurrentFileWrap(enabled) {
      const t = ensureToggle();
      if (!t) return;
      setWrapForFile(activeFilePath, enabled);
      t.setEnabled(enabled);
      notify(enabled);
    },

    setActiveFilePath(path) {
      activeFilePath = path;
      if (!toggle) return;
      const target = resolveWrapForFile(path, defaultWrapState);
      toggle.setEnabled(target);
      notify(target);
    },

    setDefaultWrap(enabled) {
      defaultWrapState = enabled;
      if (toggle) {
        const target = resolveWrapForFile(activeFilePath, defaultWrapState);
        toggle.setEnabled(target);
        notify(target);
      }
    },

    getDefaultWrap() {
      return defaultWrapState;
    },

    renamePath(oldPath, newPath) {
      renameWrapForPath(oldPath, newPath);
    },

    carryStateToNewFile(newFilePath) {
      const current = toggle?.isEnabled() ?? defaultWrapState;
      setWrapForFile(newFilePath, current);
    },

    isEnabled() {
      return toggle?.isEnabled() ?? resolveWrapForFile(activeFilePath, defaultWrapState);
    },

    getActiveFilePath() {
      return activeFilePath;
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    dispose() {
      handle.detach();
      listeners.clear();
    },
  };

  return handle;
}
