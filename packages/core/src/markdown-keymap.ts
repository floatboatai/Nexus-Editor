import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const BLOCKQUOTE_RE = /^(\s*>+ ?)/;

/** Handle Enter key for markdown auto-continuation. Returns true if handled. */
export function handleMarkdownEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const line = state.doc.lineAt(sel.head);
  const text = line.text;

  // ── List continuation ──
  const listMatch = LIST_RE.exec(text);
  if (listMatch) {
    const indent = listMatch[1];
    const marker = listMatch[2];
    const afterMarker = text.slice(listMatch[0].length);

    // Check for checkbox
    const cbMatch = CHECKBOX_RE.exec(afterMarker);
    const content = cbMatch ? afterMarker.slice(cbMatch[0].length) : afterMarker;

    // Empty item → exit list
    if (!content.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
      });
      return true;
    }

    // Calculate next marker (increment ordered numbers)
    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([.)])/);
    if (numMatch) {
      nextMarker = `${Number.parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const newPrefix = cbMatch ? `${indent}${nextMarker} [ ] ` : `${indent}${nextMarker} `;

    view.dispatch({
      changes: { from: sel.head, insert: `\n${newPrefix}` },
      selection: { anchor: sel.head + 1 + newPrefix.length },
    });
    return true;
  }

  // ── Blockquote continuation ──
  const quoteMatch = BLOCKQUOTE_RE.exec(text);
  if (quoteMatch) {
    const prefix = quoteMatch[1];
    const content = text.slice(prefix.length);

    // Empty quote → exit blockquote
    if (!content.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
      });
      return true;
    }

    view.dispatch({
      changes: { from: sel.head, insert: `\n${prefix}` },
      selection: { anchor: sel.head + 1 + prefix.length },
    });
    return true;
  }

  return false;
}

export function markdownKeymap(): Extension {
  return Prec.high(keymap.of([{ key: "Enter", run: handleMarkdownEnter }]));
}
