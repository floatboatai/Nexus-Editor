/**
 * Plugin factory wiring the snapshot engine into the editor's change
 * lifecycle. The returned object is *both* a valid `NexusPlugin` (pass it
 * to `createEditor({ plugins })`) and a live API handle (capture / list /
 * restore / subscribe) — same dual shape as `plugin-wordcount`.
 */

import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

import { SnapshotEngine } from "./engine";
import {
  createMemorySnapshotStore,
  type SnapshotMeta,
  type SnapshotStore
} from "./store";

export type Unsubscribe = () => void;

/** Editor command id for manual capture (`editor.runCommand(...)`). */
export const SNAPSHOTS_CAPTURE_COMMAND = "snapshots.capture";

export interface SnapshotsPluginOptions {
  /**
   * Host-injected persistence. Defaults to an in-memory store — no
   * implicit `localStorage` / filesystem writes.
   */
  store?: SnapshotStore;
  /**
   * Identifies the active document; snapshots are scoped per key and
   * never interleave across files. Defaults to a fixed `"default"` key,
   * which suits single-document hosts.
   */
  getDocumentKey?: () => string;
  /** Retention cap per document key. Oldest snapshots drop first. Default: 50. */
  maxSnapshots?: number;
  /**
   * Optional age-based expiry: snapshots older than this are pruned on
   * capture and when the host calls {@link SnapshotsAPI.prune} (e.g. at
   * app startup). Disabled by default. Example: 30 days is
   * `30 * 24 * 60 * 60 * 1000`.
   */
  maxAgeMs?: number;
  /**
   * Idle-based auto-capture: after each change, one snapshot is taken once
   * the user pauses for `intervalMs`. De-duplication keeps unchanged
   * documents free. Disabled by default.
   */
  autoCapture?: { intervalMs: number } | false;
  /** Label for the safety snapshot taken before a restore. Default: "Before restore". */
  restoreSafetyLabel?: string;
}

export interface SnapshotsAPI {
  /**
   * Snapshot the current document. Resolves `null` when the content is
   * unchanged since the newest snapshot, the store rejected the write, or
   * the plugin is not attached to an editor.
   */
  capture(label?: string): Promise<SnapshotMeta | null>;
  /** Newest-first snapshot metadata for the active document key. */
  list(): Promise<SnapshotMeta[]>;
  /**
   * Replace the document with a snapshot's content. Captures a safety
   * snapshot of the current buffer first (unless already identical), then
   * applies one undoable `setDocument`. Resolves `false` for missing ids.
   */
  restore(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<boolean>;
  /**
   * Remove expired (older than `maxAgeMs`) and count-overflow snapshots
   * for the active document key. Runs automatically on capture; call
   * explicitly at app startup so stale snapshots are swept even when the
   * user doesn't capture anything.
   */
  prune(): Promise<void>;
  /**
   * Subscribe to snapshot-list changes for the active document key. The
   * listener fires asynchronously with the current list, then after every
   * capture / restore / remove / clear. Returns an unsubscribe function.
   */
  subscribe(listener: (snapshots: SnapshotMeta[]) => void): Unsubscribe;
  /**
   * Bind the plugin to an editor instance. Call once after `createEditor`
   * returns — required for `capture` / `restore` / auto-capture.
   * Idempotent. Most hosts prefer the {@link attachSnapshotsPlugin} free
   * function for readability.
   */
  attachEditor(editor: EditorAPI): void;
  destroy(): void;
}

export type SnapshotsPlugin = NexusPlugin & SnapshotsAPI;

/**
 * Create a version-snapshots plugin:
 *
 * ```ts
 * const snapshots = createSnapshotsPlugin({ store: myStore });
 * const editor = createEditor({ container, plugins: [snapshots] });
 * attachSnapshotsPlugin(snapshots, editor);
 *
 * await snapshots.capture("First draft");
 * ```
 */
export function createSnapshotsPlugin(options: SnapshotsPluginOptions = {}): SnapshotsPlugin {
  const engine = new SnapshotEngine({
    store: options.store ?? createMemorySnapshotStore(),
    maxSnapshots: options.maxSnapshots,
    maxAgeMs: options.maxAgeMs
  });
  const getDocumentKey = options.getDocumentKey ?? (() => "default");
  const safetyLabel = options.restoreSafetyLabel ?? "Before restore";
  const autoIntervalMs =
    options.autoCapture && options.autoCapture.intervalMs > 0
      ? options.autoCapture.intervalMs
      : null;

  let editor: EditorAPI | null = null;
  let destroyed = false;
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  // setDocument during restore fires `change`; that edit must not schedule
  // an auto-capture, or every restore would grow a duplicate snapshot.
  let skipNextAutoCapture = false;
  const listeners = new Set<(snapshots: SnapshotMeta[]) => void>();

  const emit = async (): Promise<void> => {
    if (destroyed || listeners.size === 0) return;
    const metas = await engine.list(getDocumentKey());
    if (destroyed) return;
    for (const listener of listeners) {
      listener(metas);
    }
  };

  const captureFrom = async (target: EditorAPI, label?: string): Promise<SnapshotMeta | null> => {
    if (destroyed) return null;
    const meta = await engine.capture(getDocumentKey(), target.getDocument(), label);
    if (meta) await emit();
    return meta;
  };

  const clearAutoTimer = (): void => {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  };

  const onChange = (): void => {
    if (autoIntervalMs === null || destroyed) return;
    if (skipNextAutoCapture) {
      skipNextAutoCapture = false;
      return;
    }
    clearAutoTimer();
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (editor) void captureFrom(editor);
    }, autoIntervalMs);
  };

  const api: SnapshotsAPI = {
    capture(label) {
      return editor ? captureFrom(editor, label) : Promise.resolve(null);
    },
    list() {
      return engine.list(getDocumentKey());
    },
    async restore(id) {
      if (!editor || destroyed) return false;
      const documentKey = getDocumentKey();
      const content = await engine.load(documentKey, id);
      if (content === null || destroyed) return false;

      const current = editor.getDocument();
      if (current !== content) {
        await engine.capture(documentKey, current, safetyLabel);
        skipNextAutoCapture = true;
        editor.setDocument(content);
      }
      await emit();
      return true;
    },
    async remove(id) {
      const removed = await engine.remove(getDocumentKey(), id);
      if (removed) await emit();
      return removed;
    },
    async clear() {
      const cleared = await engine.clear(getDocumentKey());
      if (cleared) await emit();
      return cleared;
    },
    async prune() {
      await engine.prune(getDocumentKey());
      await emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      void emit();
      return () => {
        listeners.delete(listener);
      };
    },
    attachEditor(target: EditorAPI) {
      if (editor || destroyed) return;
      editor = target;
      target.on("change", onChange);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearAutoTimer();
      if (editor) {
        try {
          editor.off("change", onChange);
        } catch {
          /* editor may already be torn down */
        }
        editor = null;
      }
      listeners.clear();
    }
  };

  return {
    name: "plugin-snapshots",
    ...api,
    commands: [
      {
        id: SNAPSHOTS_CAPTURE_COMMAND,
        label: "Snapshots: Take snapshot",
        run: (target) => {
          // Command dispatch passes the editor explicitly, so a manual
          // capture works even when the host never called attachEditor.
          void captureFrom(target);
          return true;
        }
      }
    ]
  };
}

/**
 * Bind a snapshots plugin to an editor instance. Equivalent to
 * `plugin.attachEditor(editor)` but reads more naturally at the call site:
 *
 * ```ts
 * const snapshots = createSnapshotsPlugin();
 * const editor = createEditor({ container, plugins: [snapshots] });
 * attachSnapshotsPlugin(snapshots, editor);
 * ```
 */
export function attachSnapshotsPlugin(plugin: SnapshotsPlugin, editor: EditorAPI): void {
  plugin.attachEditor(editor);
}
