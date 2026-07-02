import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /**
   * The maximum time (in milliseconds) that adjacent events can be apart
   * and still be grouped together into a single undo step. Default: 500.
   */
  newGroupDelay?: number;
  /**
   * The minimum depth (number of events) to store. Default: 100.
   */
  minDepth?: number;
}

export { isolateHistory };

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        newGroupDelay: options.newGroupDelay ?? 500,
        minDepth: options.minDepth ?? 100
      }),
      keymap.of(historyKeymap)
    ]
  };
}
