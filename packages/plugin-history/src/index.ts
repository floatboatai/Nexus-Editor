import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /**
   * Time in milliseconds within which consecutive edits are merged into a
   * single undo group. Lower values make undo more granular; `0` starts a new
   * group on every change. CodeMirror's default is 500.
   */
  newGroupDelay?: number;
  /**
   * Minimum number of undo events to keep even when the history grows past the
   * internal size budget. CodeMirror's default is 100.
   */
  minDepth?: number;
}

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const historyConfig: { newGroupDelay?: number; minDepth?: number } = {};
  if (options.newGroupDelay !== undefined) historyConfig.newGroupDelay = options.newGroupDelay;
  if (options.minDepth !== undefined) historyConfig.minDepth = options.minDepth;

  return {
    name: "plugin-history",
    cmExtensions: [history(historyConfig), keymap.of(historyKeymap)]
  };
}
