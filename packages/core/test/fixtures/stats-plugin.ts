/**
 * # Demo Plugin: Stats & Logger
 *
 * A comprehensive example plugin demonstrating the Nexus Plugin Lifecycle
 * Hooks v2 API. Use this as a reference when writing your own plugins.
 *
 * ## What it demonstrates
 *
 * | Hook / API | Where | What it shows |
 * |---|---|---|
 * | `onEditorReady` | Initialisation | Registering one-shot init logic |
 * | `onAfterChange` | Edit tracking | Counting edits, character stats |
 * | `onSelectionChange` | Cursor tracking | Logging cursor position |
 * | `onBeforeSetDocument` | Content guard | Cancelling invalid content |
 * | `onDestroy` | Cleanup | Releasing plugin resources |
 * | `on('editorReady')` | Event bus | Reacting to editor readiness |
 * | `on('change')` | Event bus | Observing document changes |
 * | `on('error')` | Event bus | Error monitoring |
 * | `editor.addPlugin()` | Runtime API | Adding plugins dynamically |
 * | `editor.removePlugin()` | Runtime API | Removing plugins dynamically |
 * | `editor.hasPlugin()` | Runtime API | Querying plugin presence |
 * | `editor.getStats()` | Custom API | Reading collected metrics |
 *
 * ## Usage
 *
 * ```ts
 * import { createEditor } from "@floatboat/nexus-core";
 * import { createStatsPlugin } from "./plugins/stats-plugin";
 *
 * const statsPlugin = createStatsPlugin({ logToConsole: true });
 *
 * const editor = createEditor({
 *   container: document.getElementById("editor")!,
 *   plugins: [statsPlugin],
 * });
 *
 * // Later, read collected stats:
 * // The stats are stored on the plugin instance
 * console.log(statsPlugin.getStats());
 *
 * // Or dynamically add/remove:
 * editor.addPlugin(anotherPlugin);
 * editor.removePlugin("plugin-stats");
 * ```
 *
 * @packageDocumentation
 */

import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatsPluginOptions {
  /** Log lifecycle events to console.debug. Default: false */
  logToConsole?: boolean;
  /** If set, cancels setDocument when content exceeds this length. Default: 0 (no limit) */
  maxDocumentLength?: number;
}

export interface EditorStats {
  /** Total number of document changes observed. */
  editCount: number;
  /** Current document length in characters. */
  currentLength: number;
  /** Current word count. */
  wordCount: number;
  /** Timestamp of the last change (epoch ms). */
  lastEditAt: number;
  /** Number of times the selection changed. */
  selectionChangeCount: number;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create a stats-tracking plugin that demonstrates the full lifecycle hooks
 * and event-bus API of Nexus Editor.
 *
 * The returned object includes a `getStats()` helper so consumers can read
 * the metrics the plugin collects. This pattern — a factory function that
 * returns both a plugin object and a public API — is the recommended way to
 * write plugins that expose data to the host.
 */
export function createStatsPlugin(options: StatsPluginOptions = {}): NexusPlugin & { getStats(): EditorStats } {
  const log = options.logToConsole ?? false;
  const maxLen = options.maxDocumentLength ?? 0;

  // Internal mutable state (not exported, encapsulated in the closure).
  let editorRef: EditorAPI | null = null;
  let destroyTimer: ReturnType<typeof setTimeout> | null = null;

  const stats: EditorStats = {
    editCount: 0,
    currentLength: 0,
    wordCount: 0,
    lastEditAt: 0,
    selectionChangeCount: 0,
  };

  // ---- Lifecycle hooks ------------------------------------------------

  const plugin: NexusPlugin = {
    name: "plugin-stats",

    // ── onEditorReady ──────────────────────────────────────────────────
    // Fired once after the editor view is mounted and EditorAPI is ready.
    // Safe to call any editor method. Use this for one-time setup.
    onEditorReady(editor: EditorAPI) {
      editorRef = editor;
      if (log) {
        console.debug("[stats] Editor ready — tracking begins");
      }

      // Initialise stats from the current document.
      const doc = editor.getDocument();
      stats.currentLength = doc.length;
      stats.wordCount = countWords(doc);

      // Example: subscribe to additional event-bus events via `editor.on`.
      // This demonstrates how lifecycle hooks and event-bus subscriptions
      // work together.
      editor.on("error", (_error: Error, source?: string) => {
        if (log) {
          console.debug(`[stats] Error from ${source ?? "unknown source"}`);
        }
      });

      // Subscribe to the "destroy" event so we can clean up even if our
      // own onDestroy is called last (after other plugins have cleaned up).
      editor.on("destroy", () => {
        if (destroyTimer) {
          clearTimeout(destroyTimer);
          destroyTimer = null;
        }
        if (log) {
          console.debug("[stats] Editor destroyed — stats cleared");
        }
      });
    },

    // ── onAfterChange ──────────────────────────────────────────────────
    // Fired after every external change event. Updates counters and stats.
    onAfterChange(ctx) {
      stats.editCount++;
      stats.currentLength = ctx.doc.length;
      stats.wordCount = countWords(ctx.doc);
      stats.lastEditAt = Date.now();

      if (log) {
        console.debug(`[stats] Change #${stats.editCount}: ${stats.currentLength} chars, ${stats.wordCount} words`);
      }
    },

    // ── onBeforeSetDocument ────────────────────────────────────────────
    // Fired before setDocument replaces content. Return false to cancel.
    // Useful for content validation, size limits, or confirmation dialogs.
    onBeforeSetDocument(ctx) {
      if (maxLen > 0 && ctx.next.length > maxLen) {
        if (log) {
          console.warn(
            `[stats] Blocked setDocument: ${ctx.next.length} chars exceeds limit of ${maxLen}`,
          );
        }
        return false; // cancels the replacement
      }
      // Returning undefined/void means "proceed"
    },

    // ── onSelectionChange ──────────────────────────────────────────────
    // Fired on every cursor movement or range selection change.
    onSelectionChange(ctx) {
      stats.selectionChangeCount++;
      if (log && stats.selectionChangeCount <= 3) {
        // Only log the first few to avoid console spam.
        console.debug(`[stats] Selection moved to { anchor: ${ctx.anchor}, head: ${ctx.head} }`);
      }
    },

    // ── onDestroy ──────────────────────────────────────────────────────
    // Fired when the editor is being destroyed. Clean up any resources
    // the plugin created (timers, DOM nodes, event listeners).
    onDestroy(_editor: EditorAPI) {
      if (destroyTimer) {
        clearTimeout(destroyTimer);
        destroyTimer = null;
      }
      if (log) {
        console.debug("[stats] Plugin destroyed — final stats:", { ...stats });
      }
      editorRef = null;
    },
  };

  // Return the plugin augmented with a public stats API.
  return Object.assign(plugin, {
    getStats(): EditorStats {
      return { ...stats };
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countWords(doc: string): number {
  const trimmed = doc.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
