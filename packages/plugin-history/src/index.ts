import {
  history,
  historyKeymap,
  isolateHistory,
  undoDepth,
  redoDepth
} from "@codemirror/commands";
import { Annotation, type Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import { isTableEditing, type NexusPlugin } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /** Minimum number of history events to retain. Default: 100 */
  minDepth?: number;
  /** Maximum time (ms) between adjacent changes that can be merged. Default: 500 */
  newGroupDelay?: number;
  /** Automatically group all dispatches during table editing into one undo step. Default: true */
  groupTableEdits?: boolean;
}

/**
 * Annotation attached to transactions that should be force-joined into
 * the current history group regardless of time delay.
 */
export const forceGroup = Annotation.define<boolean>();

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const {
    minDepth = 100,
    newGroupDelay = 500,
    groupTableEdits = true,
  } = options;

  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        minDepth,
        newGroupDelay,
        joinToEvent(tr: Transaction, isAdjacent: boolean) {
          if (tr.annotation(forceGroup)) return true;
          if (groupTableEdits && isTableEditing()) return true;
          return isAdjacent;
        },
      }),
      keymap.of(historyKeymap),
    ],
  };
}

export { isolateHistory, undoDepth, redoDepth };
