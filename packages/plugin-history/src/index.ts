import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/** Matches table widget commits. Not a host API. */
const TABLE_CELL_USER_EVENT = "input.table.cell";
const TABLE_STRUCTURE_USER_EVENT = "input.table.structure";

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
