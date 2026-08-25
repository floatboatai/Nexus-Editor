import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

type CodeMirrorHistoryConfig = NonNullable<Parameters<typeof history>[0]>;

export interface HistoryPluginOptions {
  /**
   * Minimum number of undo/redo events kept in history.
   *
   * Passed through to CodeMirror's history extension. Defaults to
   * CodeMirror's built-in value.
   */
  minDepth?: CodeMirrorHistoryConfig["minDepth"];
  /**
   * Maximum time in milliseconds for adjacent edits to join one undo event.
   *
   * Set to 0 when hosts need every editor dispatch to be undoable
   * independently.
   */
  newGroupDelay?: CodeMirrorHistoryConfig["newGroupDelay"];
  /**
   * Custom predicate that decides whether a transaction joins the previous
   * undo event while still inside newGroupDelay.
   */
  joinToEvent?: CodeMirrorHistoryConfig["joinToEvent"];
}

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [history(options), keymap.of(historyKeymap)]
  };
}
