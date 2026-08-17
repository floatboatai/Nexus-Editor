import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";
import { SnapshotManager, type Snapshot } from "./snapshot";

export { SnapshotManager, type Snapshot } from "./snapshot";

export function createHistoryPlugin(): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [history(), keymap.of(historyKeymap)]
  };
}
