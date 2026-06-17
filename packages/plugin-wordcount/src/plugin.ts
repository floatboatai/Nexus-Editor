/**
 * Plugin factory that wires {@link countMarkdown} into the editor's
 * change / selection lifecycle. The returned object is *both* a valid
 * `NexusPlugin` (so it can be passed to `createEditor({ plugins })`)
 * and a live query handle (so the host can subscribe / read stats /
 * tear down without holding a separate reference).
 */

import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

import { countMarkdown, type WordCountOptions, type WordCountStats } from "./count";
import {
  createStatusBar,
  defaultStatusBarLabels,
  type StatusBarHandle,
  type StatusBarOptions,
  type WordCountLabels
} from "./status-bar";

export type Unsubscribe = () => void;

export interface WordCountState {
  /** Stats for the entire document. */
  doc: WordCountStats;
  /** Stats for the current selection. Zero-valued when no selection is active. */
  selection: WordCountStats;
  /** True when the selection covers a non-empty range. */
  isSelectionActive: boolean;
}

export interface WordCountPluginOptions {
  /**
   * Throttle window in milliseconds for full-document recomputes.
   * Selection stats are always synchronous (see design.md §Decision 5).
   * Default: 150 — matches `parseDelayMs` in `core`.
   */
  debounceMs?: number;
  /** Forwarded to {@link countMarkdown}. */
  cjkUnit?: WordCountOptions["cjkUnit"];
  /** Forwarded to {@link countMarkdown}. */
  exclude?: WordCountOptions["exclude"];
  /** Forwarded to {@link countMarkdown}. */
  readingSpeed?: WordCountOptions["readingSpeed"];
  /**
   * Mount the bundled status-bar widget. `false` (default) keeps the
   * plugin headless; pass `{}` to mount with defaults, or supply
   * `StatusBarOptions` to customise container, labels, locale, etc.
   */
  statusBar?: false | StatusBarOptions;
  /**
   * Override visible strings. Forwarded to the status bar as the
   * baseline; per-call overrides on `statusBar.labels` win.
   */
  labels?: Partial<WordCountLabels>;
}

export interface WordCountAPI {
  /** Latest full-document statistics. */
  getStats(): WordCountStats;
  /** Latest selection statistics (zero-valued if no active selection). */
  getSelectionStats(): WordCountStats;
  /** True while the selection covers a non-empty range. */
  isSelectionActive(): boolean;
  /**
   * Subscribe to state changes. The listener is invoked once
   * synchronously with the current state, then on every recompute.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (state: WordCountState) => void): Unsubscribe;
  /** Tear down listeners and the optional status bar. */
  destroy(): void;
}

export type WordCountPlugin = NexusPlugin &
  WordCountAPI & {
    /**
     * Bind the plugin to an editor instance. Call once after
     * `createEditor` returns. Idempotent — subsequent calls are
     * ignored. Most hosts will prefer the {@link attachWordCountPlugin}
     * free function for readability.
     */
    attachEditor(editor: EditorAPI): void;
  };

const EMPTY_STATS: WordCountStats = Object.freeze({
  words: 0,
  latinWords: 0,
  cjkCharacters: 0,
  characters: 0,
  charactersNoSpaces: 0,
  lines: 0,
  paragraphs: 0,
  sentences: 0,
  readingTimeSeconds: 0
});

const EMPTY_STATE: WordCountState = Object.freeze({
  doc: EMPTY_STATS,
  selection: EMPTY_STATS,
  isSelectionActive: false
});

/**
 * Create a wordcount plugin. The returned value can be passed straight
 * into `createEditor({ plugins: [...] })` and *also* used as a query
 * handle:
 *
 * ```ts
 * const wordcount = createWordCountPlugin({ statusBar: {} });
 * const editor = createEditor({ container, plugins: [wordcount] });
 * attachWordCountPlugin(wordcount, editor);
 *
 * wordcount.subscribe(({ doc }) => console.log(doc.words));
 * ```
 */
export function createWordCountPlugin(options: WordCountPluginOptions = {}): WordCountPlugin {
  const debounceMs = Math.max(0, options.debounceMs ?? 150);
  const countOptions: WordCountOptions = {
    cjkUnit: options.cjkUnit,
    exclude: options.exclude,
    readingSpeed: options.readingSpeed
  };
  const baselineLabels: WordCountLabels = { ...defaultStatusBarLabels, ...options.labels };

  let editor: EditorAPI | null = null;
  let destroyed = false;
  let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  let state: WordCountState = EMPTY_STATE;
  const listeners = new Set<(state: WordCountState) => void>();
  let statusBar: StatusBarHandle | null = null;

  const emit = (): void => {
    if (destroyed) return;
    for (const listener of listeners) {
      listener(state);
    }
  };

  const computeDoc = (): WordCountStats => {
    if (!editor) return EMPTY_STATS;
    try {
      const ast = editor.getAst();
      const source = editor.getDocument();
      return countMarkdown(source, { ...countOptions, ast });
    } catch {
      return EMPTY_STATS;
    }
  };

  const computeSelection = (): { stats: WordCountStats; isActive: boolean } => {
    if (!editor) return { stats: EMPTY_STATS, isActive: false };
    try {
      const { anchor, head } = editor.getSelection();
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      if (from === to) {
        return { stats: EMPTY_STATS, isActive: false };
      }
      const slice = editor.getDocument().slice(from, to);
      const stats = countMarkdown(slice, countOptions);
      return { stats, isActive: true };
    } catch {
      return { stats: EMPTY_STATS, isActive: false };
    }
  };

  const recomputeDoc = (): void => {
    if (destroyed) return;
    const docStats = computeDoc();
    const { stats: selStats, isActive } = computeSelection();
    state = { doc: docStats, selection: selStats, isSelectionActive: isActive };
    emit();
  };

  const recomputeSelection = (): void => {
    if (destroyed) return;
    const { stats, isActive } = computeSelection();
    if (stats === state.selection && isActive === state.isSelectionActive) {
      return;
    }
    state = { doc: state.doc, selection: stats, isSelectionActive: isActive };
    emit();
  };

  const scheduleDocRecompute = (): void => {
    if (destroyed) return;
    if (recomputeTimer) clearTimeout(recomputeTimer);
    if (debounceMs === 0) {
      recomputeDoc();
      return;
    }
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null;
      recomputeDoc();
    }, debounceMs);
  };

  const onChange = (): void => scheduleDocRecompute();
  const onSelectionChange = (): void => recomputeSelection();

  const api: WordCountAPI = {
    getStats: () => state.doc,
    getSelectionStats: () => state.selection,
    isSelectionActive: () => state.isSelectionActive,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (recomputeTimer) {
        clearTimeout(recomputeTimer);
        recomputeTimer = null;
      }
      statusBar?.destroy();
      statusBar = null;
      if (editor) {
        try {
          editor.off("change", onChange);
          editor.off("selectionChange", onSelectionChange);
        } catch {
          /* editor may already be torn down */
        }
        editor = null;
      }
      listeners.clear();
    }
  };

  const plugin: WordCountPlugin = {
    name: "plugin-wordcount",
    cmExtensions: [],
    ...api,
    attachEditor(target: EditorAPI) {
      if (editor || destroyed) return;
      editor = target;
      target.on("change", onChange);
      target.on("selectionChange", onSelectionChange);
      // Initial computation in a microtask so listeners that subscribe
      // synchronously after `createEditor` returns still see the first
      // emission via their subscribe() snapshot, then again on the
      // initial compute.
      queueMicrotask(() => {
        if (destroyed) return;
        recomputeDoc();
        if (options.statusBar) {
          const statusBarOptions = options.statusBar;
          const mergedLabels: WordCountLabels = {
            ...baselineLabels,
            ...statusBarOptions.labels
          };
          statusBar = createStatusBar(api, {
            ...statusBarOptions,
            labels: mergedLabels
          });
        }
      });
    }
  };

  return plugin;
}

/**
 * Bind a wordcount plugin to an editor instance. Equivalent to
 * `plugin.attachEditor(editor)` but reads more naturally at the call
 * site:
 *
 * ```ts
 * const wordcount = createWordCountPlugin();
 * const editor = createEditor({ container, plugins: [wordcount] });
 * attachWordCountPlugin(wordcount, editor);
 * ```
 */
export function attachWordCountPlugin(plugin: WordCountPlugin, editor: EditorAPI): void {
  plugin.attachEditor(editor);
}
