import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

export interface AutoSaveOptions {
  /**
   * Called with the current Markdown source whenever a debounced save
   * fires. A rejected promise is swallowed so a failing sink can't
   * break the editor's change loop.
   */
  onSave: (markdown: string) => void | Promise<void>;
  /**
   * Quiet period in milliseconds after the last edit before `onSave`
   * runs. Default: 1000. Set to 0 to save on every change.
   */
  delay?: number;
}

export interface AutoSaveAPI {
  /** Force an immediate save of the current document. */
  flush(): void;
  /** Stop listening and cancel any pending save. */
  destroy(): void;
}

export type AutoSavePlugin = NexusPlugin &
  AutoSaveAPI & {
    /**
     * Bind the plugin to an editor instance. Call once after
     * `createEditor` returns. Most hosts will prefer the
     * {@link attachAutoSavePlugin} free function for readability.
     */
    attachEditor(editor: EditorAPI): void;
  };

export function createAutoSavePlugin(options: AutoSaveOptions): AutoSavePlugin {
  const delay = Math.max(0, options.delay ?? 1000);
  const onSave = options.onSave;

  let editor: EditorAPI | null = null;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const saveNow = (): void => {
    if (destroyed || !editor) return;
    const markdown = editor.getDocument();
    Promise.resolve(onSave(markdown)).catch(() => {});
  };

  const schedule = (): void => {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    if (delay === 0) {
      saveNow();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      saveNow();
    }, delay);
  };

  const onChange = (): void => schedule();

  const api: AutoSaveAPI = {
    flush() {
      if (destroyed || !editor) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      saveNow();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (editor) {
        try {
          editor.off("change", onChange);
        } catch {
          /* editor may already be torn down */
        }
        editor = null;
      }
    }
  };

  const plugin: AutoSavePlugin = {
    name: "plugin-autosave",
    cmExtensions: [],
    ...api,
    attachEditor(target: EditorAPI) {
      if (editor || destroyed) return;
      editor = target;
      target.on("change", onChange);
    }
  };

  return plugin;
}

/**
 * Bind an auto-save plugin to an editor instance. Equivalent to
 * `plugin.attachEditor(editor)` but reads more naturally at the call
 * site:
 *
 * ```ts
 * const autosave = createAutoSavePlugin({ onSave: persist });
 * const editor = createEditor({ container, plugins: [autosave] });
 * attachAutoSavePlugin(autosave, editor);
 * ```
 */
export function attachAutoSavePlugin(plugin: AutoSavePlugin, editor: EditorAPI): void {
  plugin.attachEditor(editor);
}
