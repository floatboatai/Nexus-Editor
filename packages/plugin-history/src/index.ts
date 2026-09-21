import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/** Matches table widget commits. Not a host API. */
const TABLE_CELL_USER_EVENT = "input.table.cell";
const TABLE_STRUCTURE_USER_EVENT = "input.table.structure";

/**
 * Table widgets tag cell/structure commits with dedicated userEvents.
 * isolateHistory("full") so they never join adjacent typing or each other.
 * Silent document loads stay out of history in core (`addToHistory: false`),
 * not here — that is a file-open concern, not a grouping option.
 */
function isolateTableHistory() {
  return EditorState.transactionExtender.of((tr) => {
    if (!tr.docChanged) return null;
    const event = tr.annotation(Transaction.userEvent);
    if (event !== TABLE_CELL_USER_EVENT && event !== TABLE_STRUCTURE_USER_EVENT) return null;
    return { annotations: isolateHistory.of("full") };
  });
}

export function createHistoryPlugin(): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [history(), isolateTableHistory(), keymap.of(historyKeymap)]
  };
}
