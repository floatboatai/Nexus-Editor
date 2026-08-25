import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /** Minimum depth of undo entries to keep. Maps to CM6 `minDepth`. */
  minDepth?: number;
  /** Delay in ms before consecutive edits are grouped. Maps to CM6 `newGroupDelay`. */
  newGroupDelay?: number;
}

export function createHistoryPlugin(options?: HistoryPluginOptions): NexusPlugin {
  const exts: Parameters<typeof history>[0] | undefined =
    options !== undefined
      ? {
          ...(options.minDepth !== undefined && { minDepth: options.minDepth }),
          ...(options.newGroupDelay !== undefined && { newGroupDelay: options.newGroupDelay }),
        }
      : undefined;

  return {
    name: "plugin-history",
    cmExtensions: [history(exts), keymap.of(historyKeymap)],
  };
}