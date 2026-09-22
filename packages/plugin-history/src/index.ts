import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Options for the history (undo/redo) plugin.
 */
export interface HistoryPluginOptions {
  /**
   * The minimum time (in milliseconds) that must pass between two edits
   * for them to be placed in separate history groups (undo steps).
   *
   * A longer value means that fast consecutive typing is grouped together,
   * while pausing for longer than this threshold starts a new undo group.
   *
   * @default 1500 — A 1.5-second pause starts a new undo step, which
   * matches natural writing rhythm better than the CM6 default of 500ms.
   * With 500ms, typing a sentence continuously can require many Ctrl+Z
   * presses to fully undo it. With 1500ms, a single Ctrl+Z typically
   * reverts the last "burst" of typing.
   */
  newGroupDelay?: number;

  /**
   * The minimum number of events that the history will retain. Defaults
   * to the CodeMirror default (100).
   */
  minDepth?: number;
}

/**
 * Creates a history plugin that enables undo/redo with Ctrl+Z / Ctrl+Shift+Z.
 *
 * @example
 * // Default: 1.5-second pause creates a new undo group
 * createHistoryPlugin()
 *
 * @example
 * // Custom: aggressive grouping (500ms, closer to raw CM6 default)
 * createHistoryPlugin({ newGroupDelay: 500 })
 *
 * @example
 * // Custom: very relaxed grouping (3 seconds)
 * createHistoryPlugin({ newGroupDelay: 3000 })
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        newGroupDelay: options.newGroupDelay ?? 1500,
        minDepth: options.minDepth,
      }),
      keymap.of(historyKeymap),
    ],
  };
}
