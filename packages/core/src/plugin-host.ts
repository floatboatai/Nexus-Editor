/**
 * PluginHost — manages plugin lifecycle hooks and dynamic plugin
 * registration for the Nexus editor.
 *
 * Lifecycle hooks let plugins react to editor events at a higher level
 * than raw CM6 extensions or DOM handlers:
 *
 *   - `onEditorReady` — editor fully initialized, view mounted
 *   - `onBeforeChange` — before a change event fires (can cancel)
 *   - `onAfterChange` — after a change event fires
 *   - `onBeforeSetDocument` — before document replacement (can cancel)
 *   - `onSelectionChange` — cursor / selection moved
 *   - `onDestroy` — editor being torn down
 *
 * Each hook is isolated: an error in one plugin never prevents other
 * plugins from receiving the hook, and the editor continues normally.
 *
 * @module
 */

import type { EditorAPI, NexusPlugin } from "./types";
import type { Root } from "mdast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context object passed to the `onBeforeChange` lifecycle hook.
 */
export interface BeforeChangeContext {
  /** The full document after the change. */
  doc: string;
  /** The current AST. */
  ast: Root;
}

/**
 * Context object passed to the `onAfterChange` lifecycle hook.
 */
export interface AfterChangeContext {
  /** The full document. */
  doc: string;
  /** The current AST. */
  ast: Root;
}

/**
 * Context object passed to the `onBeforeSetDocument` lifecycle hook.
 */
export interface BeforeSetDocumentContext {
  /** The document content that will replace the current content. */
  next: string;
  /** Whether the replacement is "silent" (no onChange emission). */
  silent: boolean;
}

/**
 * Context object passed to the `onSelectionChange` lifecycle hook.
 */
export interface SelectionChangeContext {
  /** The anchor (start) position of the selection. */
  anchor: number;
  /** The head (end) position of the selection. */
  head: number;
}

/**
 * Lifecycle hooks that a {@link NexusPlugin} can optionally implement.
 *
 * These are merged directly into the `NexusPlugin` interface so existing
 * plugins remain 100% backward-compatible — new hooks are simply ignored
 * by plugins that don't declare them.
 */
export interface PluginLifecycleHooks {
  /**
   * Called after the editor is fully initialised and the CodeMirror view
   * is mounted into the DOM. Safe to call `editor.getDocument()` etc.
   *
   * When the hook returns a Promise, the editor does **not** await it
   * before proceeding — async setup runs in the background so the editor
   * is immediately usable.
   */
  onEditorReady?: (editor: EditorAPI) => void | Promise<void>;

  /**
   * Called **before** a `change` event is emitted. Return `false` to
   * prevent the change event from being dispatched to external consumers.
   *
   * Note: this does NOT prevent the document from being changed — the
   * edit has already been applied to the editor state. It only controls
   * whether `config.onChange` and the `change` event on `EditorEventMap`
   * fire.
   */
  onBeforeChange?: (ctx: BeforeChangeContext) => boolean | void;

  /**
   * Called **after** a `change` event has been emitted. Receives the
   * same document and AST as the change event.
   */
  onAfterChange?: (ctx: AfterChangeContext) => void;

  /**
   * Called before `editor.setDocument()` replaces the content. Return
   * `false` to prevent the replacement.
   */
  onBeforeSetDocument?: (ctx: BeforeSetDocumentContext) => boolean | void;

  /**
   * Called when the editor is being destroyed. Use this to clean up
   * plugin resources (event listeners, timers, DOM nodes).
   */
  onDestroy?: (editor: EditorAPI) => void;

  /**
   * Called when the selection changes (cursor move, range selection, etc.).
   */
  onSelectionChange?: (ctx: SelectionChangeContext) => void;
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

/**
 * Internal representation of a registered plugin with its lifecycle hooks.
 */
interface PluginRecord {
  plugin: NexusPlugin;
  /** The hooks extracted at registration time. */
  hooks: Required<PluginLifecycleHooks>;
}

/**
 * Ordered hook collection used during dispatch.
 */
type HookName = keyof PluginLifecycleHooks;

const HOOK_NAMES: HookName[] = [
  "onEditorReady",
  "onBeforeChange",
  "onAfterChange",
  "onBeforeSetDocument",
  "onDestroy",
  "onSelectionChange",
];

/**
 * Extracts lifecycle hooks from a plugin, returning no-op defaults for
 * hooks the plugin did not define.
 */
function extractHooks(plugin: NexusPlugin): Required<PluginLifecycleHooks> {
  return {
    onEditorReady: plugin.onEditorReady ?? (() => {}),
    onBeforeChange: plugin.onBeforeChange ?? (() => {}),
    onAfterChange: plugin.onAfterChange ?? (() => {}),
    onBeforeSetDocument: plugin.onBeforeSetDocument ?? (() => {}),
    onDestroy: plugin.onDestroy ?? (() => {}),
    onSelectionChange: plugin.onSelectionChange ?? (() => {}),
  };
}

/**
 * Error callback for forwarding plugin errors to the editor's event bus.
 * @internal
 */
export type PluginErrorHandler = (error: Error, pluginName: string, hookName: string) => void;

/**
 * Manages plugin lifecycle hooks for the editor.
 *
 * Usage (inside the editor's `createEditor`):
 *
 *   const host = new PluginHost(config.plugins ?? [], (err, name, hook) => {
 *     emitter.emit("error", err, `plugin:${name}:${hook}`);
 *   });
 *   // ...
 *   viewRef.current = view;
 *   host.setEditor(api);
 *   host.editorReady();
 *   // ...
 *   host.beforeChange(doc, ast)   // guard emitChange
 *   host.afterChange(doc, ast)    // after emitChange
 *   host.destroy()                // in api.destroy
 */
export class PluginHost {
  private records: PluginRecord[] = [];
  private editor: EditorAPI | null = null;
  private destroyed = false;
  private onError: PluginErrorHandler | null;

  /**
   * @param initialPlugins  Plugins passed at editor creation time.
   * @param onError  Optional callback invoked when a plugin lifecycle hook
   *   throws. The editor should wire this to its `error` event.
   */
  constructor(initialPlugins: NexusPlugin[], onError?: PluginErrorHandler | null) {
    this.onError = onError ?? null;
    for (const plugin of initialPlugins) {
      this.register(plugin);
    }
  }

  // -----------------------------------------------------------------------
  // Dynamic plugin management
  // -----------------------------------------------------------------------

  /**
   * Add a plugin at runtime. Returns `true` if added, `false` if a plugin
   * with the same name is already registered.
   */
  addPlugin(plugin: NexusPlugin): boolean {
    if (this.records.some((r) => r.plugin.name === plugin.name)) {
      return false;
    }
    this.register(plugin);

    // If the editor is already initialised, fire onEditorReady immediately
    // so the newly-added plugin doesn't miss it.
    if (this.editor && plugin.onEditorReady && !this.destroyed) {
      this.safeInvoke(`onEditorReady`, plugin, () => plugin.onEditorReady!(this.editor!));
    }

    return true;
  }

  /**
   * Remove a plugin by name. Returns `true` if found and removed, `false`
   * otherwise. Fires `onDestroy` for the removed plugin.
   */
  removePlugin(name: string): boolean {
    const idx = this.records.findIndex((r) => r.plugin.name === name);
    if (idx < 0) return false;

    const record = this.records[idx];
    if (record.plugin.onDestroy && this.editor && !this.destroyed) {
      this.safeInvoke(`onDestroy`, record.plugin, () => record.plugin.onDestroy!(this.editor!));
    }

    this.records.splice(idx, 1);
    return true;
  }

  /**
   * Check whether a plugin is registered.
   */
  hasPlugin(name: string): boolean {
    return this.records.some((r) => r.plugin.name === name);
  }

  /**
   * Get a registered plugin by name, or `undefined`.
   */
  getPlugin(name: string): NexusPlugin | undefined {
    return this.records.find((r) => r.plugin.name === name)?.plugin;
  }

  /**
   * Return a snapshot of all currently-registered plugins.
   */
  getPlugins(): NexusPlugin[] {
    return this.records.map((r) => r.plugin);
  }

  // -----------------------------------------------------------------------
  // Editor lifecycle integration — called by the editor host
  // -----------------------------------------------------------------------

  /**
   * Provide the EditorAPI reference so lifecycle hooks can call back into
   * the editor.
   */
  setEditor(editor: EditorAPI): void {
    this.editor = editor;
  }

  /**
   * Fire `onEditorReady` for all plugins. Called once after the editor is
   * fully initialised.
   */
  editorReady(): void {
    if (this.destroyed) return;
    for (const record of this.records) {
      if (record.plugin.onEditorReady) {
        this.safeInvoke(`onEditorReady`, record.plugin, () => record.plugin.onEditorReady!(this.editor!));
      }
    }
  }

  /**
   * Fire `onBeforeChange` for all plugins. Returns `true` if the change
   * should proceed, `false` if any plugin cancelled it.
   */
  beforeChange(doc: string, ast: Root): boolean {
    if (this.destroyed) return true;
    let cancelled = false;
    for (const record of this.records) {
      if (record.plugin.onBeforeChange) {
        this.safeInvoke(`onBeforeChange`, record.plugin, () => {
          const result = record.plugin.onBeforeChange!({ doc, ast });
          if (result === false) cancelled = true;
        });
      }
    }
    return !cancelled;
  }

  /**
   * Fire `onAfterChange` for all plugins.
   */
  afterChange(doc: string, ast: Root): void {
    if (this.destroyed) return;
    for (const record of this.records) {
      if (record.plugin.onAfterChange) {
        this.safeInvoke(`onAfterChange`, record.plugin, () =>
          record.plugin.onAfterChange!({ doc, ast }),
        );
      }
    }
  }

  /**
   * Fire `onBeforeSetDocument` for all plugins. Returns `true` if the
   * replacement should proceed, `false` if any plugin cancelled it.
   */
  beforeSetDocument(next: string, silent: boolean): boolean {
    if (this.destroyed) return true;
    let cancelled = false;
    for (const record of this.records) {
      if (record.plugin.onBeforeSetDocument) {
        this.safeInvoke(`onBeforeSetDocument`, record.plugin, () => {
          const result = record.plugin.onBeforeSetDocument!({ next, silent });
          if (result === false) cancelled = true;
        });
      }
    }
    return !cancelled;
  }

  /**
   * Fire `onDestroy` for all plugins. Called once during editor teardown.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const record of this.records) {
      if (record.plugin.onDestroy) {
        this.safeInvoke(`onDestroy`, record.plugin, () => record.plugin.onDestroy!(this.editor!));
      }
    }
    this.editor = null;
  }

  /**
   * Fire `onSelectionChange` for all plugins.
   */
  selectionChange(anchor: number, head: number): void {
    if (this.destroyed) return;
    for (const record of this.records) {
      if (record.plugin.onSelectionChange) {
        this.safeInvoke(`onSelectionChange`, record.plugin, () =>
          record.plugin.onSelectionChange!({ anchor, head }),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private register(plugin: NexusPlugin): void {
    this.records.push({ plugin, hooks: extractHooks(plugin) });
  }

  private safeInvoke(hook: string, plugin: NexusPlugin, fn: () => void): void {
    try {
      fn();
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(err, plugin.name, hook);
      console.error(`[PluginHost] Error in "${plugin.name}" hook "${hook}":`, err);
    }
  }
}
