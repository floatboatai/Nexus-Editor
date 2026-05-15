import { history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import { isTableEditing } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

const tableEditUserEvent = Transaction.userEvent.of("table.edit");

function historyGrouping() {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.annotation(Transaction.userEvent) || !tr.docChanged) return tr;
    if (isTableEditing()) {
      return [tr, { annotations: tableEditUserEvent }];
    }
    return tr;
  });
}

export function createHistoryPlugin(): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [historyGrouping(), history(), keymap.of(historyKeymap)]
  };
}
