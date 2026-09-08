import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

import {
  runInHistoryGroup,
  withIsolatedHistory,
  type IsolateHistoryMode
} from "./history-group";

export interface HistoryPluginOptions {
  /** Max ms between adjacent events that may still merge. CM6 default: 500 */
  newGroupDelay?: number;
  /** Minimum history depth. CM6 default: 100 */
  minDepth?: number;
}

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const config =
    options.newGroupDelay === undefined && options.minDepth === undefined
      ? undefined
      : {
          ...(options.newGroupDelay !== undefined
            ? { newGroupDelay: options.newGroupDelay }
            : {}),
          ...(options.minDepth !== undefined ? { minDepth: options.minDepth } : {})
        };

  return {
    name: "plugin-history",
    cmExtensions: [history(config), keymap.of(historyKeymap)]
  };
}

export {
  isolateHistory,
  runInHistoryGroup,
  withIsolatedHistory,
  type IsolateHistoryMode
};
