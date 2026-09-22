import { EditorState, type ChangeSpec, type Extension } from "@codemirror/state";

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function isWellFormed(text: string): boolean {
  return !new RegExp(loneSurrogate.source, "u").test(text);
}

/** Yjs replaces split surrogate pairs; do so in the accepted local transaction too. */
export function unicodeTransactions(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    const repairs = new Map<number, ChangeSpec>();
    transaction.changes.iterChangedRanges((_from, _to, from, to) => {
      const start = Math.max(0, from - 1);
      const end = Math.min(transaction.newDoc.length, to + 1);
      const contextStart = Math.max(0, start - 1);
      const contextEnd = Math.min(transaction.newDoc.length, end + 1);
      const context = transaction.newDoc.sliceString(contextStart, contextEnd);
      for (const match of context.matchAll(loneSurrogate)) {
        const position = contextStart + match.index;
        if (position >= start && position < end) {
          repairs.set(position, { from: position, to: position + 1, insert: "\uFFFD" });
        }
      }
    });
    return repairs.size === 0 ? transaction : [
      transaction,
      { changes: [...repairs.values()], sequential: true },
    ];
  });
}
