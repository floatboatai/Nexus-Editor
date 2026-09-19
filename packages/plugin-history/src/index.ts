import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export function createHistoryPlugin(): NexusPlugin {
  return {
    name: "plugin-history",
    // Declaring the compartment lets the editor drop the undo/redo stacks when
    // a host loads a new document with `setDocument(..., { history: "reset" })`.
    historyCompartment: true,
    cmExtensions: [history(), keymap.of(historyKeymap)]
  };
}
