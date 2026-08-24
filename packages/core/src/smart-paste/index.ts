/**
 * Markdown-aware smart paste & copy — see `openspec/changes/add-smart-paste`.
 *
 * The behavior object plugs into the editor's existing `domEventHandlers`
 * slot: `paste` returns whether the event was consumed (the caller then
 * prevents the default), while `copy` / `cut` only enrich the clipboard with
 * a `text/markdown` flavor and never consume.
 */

import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { SmartPasteOptions } from "../types";
import { htmlTableToGfm } from "./html-table-to-gfm";
import { applyUrlLinkify } from "./url-linkify";

export { htmlTableToGfm } from "./html-table-to-gfm";
export { applyUrlLinkify } from "./url-linkify";
export type { SmartPasteOptions } from "../types";

interface ResolvedSmartPasteOptions {
  tables: boolean;
  linkify: boolean;
  markdownCopy: boolean;
}

export interface SmartPasteBehavior {
  /** Returns `true` when the paste was transformed and should be consumed. */
  paste(event: ClipboardEvent, view: EditorView): boolean;
  /** Enrich the clipboard with the `text/markdown` flavor. Never consumes. */
  copy(event: ClipboardEvent, view: EditorView): void;
  /** Same enrichment as {@link copy}; the native cut still deletes the range. */
  cut(event: ClipboardEvent, view: EditorView): void;
}

const MARKDOWN_MIME_TYPE = "text/markdown";

export function createSmartPasteBehavior(
  config: boolean | SmartPasteOptions | undefined,
): SmartPasteBehavior | null {
  if (config == null || config === false) return null;

  const options: ResolvedSmartPasteOptions =
    config === true
      ? { tables: true, linkify: true, markdownCopy: true }
      : {
          tables: config.tables !== false,
          linkify: config.linkify !== false,
          markdownCopy: config.markdownCopy !== false,
        };

  return {
    paste(event, view) {
      const data = event.clipboardData;
      if (!data) return false;

      if (options.tables) {
        const html = readFlavor(data, "text/html");
        if (html) {
          const gfm = htmlTableToGfm(html);
          if (gfm !== null) {
            insertAtomically(view, gfm);
            return true;
          }
        }
      }

      if (options.linkify) {
        const text = readFlavor(data, "text/plain");
        if (text) {
          const selection = view.state.selection;
          // Linkify reads the label from the (single) selection; with multiple
          // ranges the wrong label would land in every other cursor.
          if (selection.ranges.length !== 1) return false;
          const main = selection.main;
          const selected = main.empty
            ? ""
            : view.state.sliceDoc(main.from, main.to);
          const replacement = applyUrlLinkify(text, selected);
          if (replacement !== null) {
            insertAtomically(view, replacement);
            return true;
          }
        }
      }

      return false;
    },

    copy(event, view) {
      writeMarkdownFlavor(event, view);
    },

    cut(event, view) {
      writeMarkdownFlavor(event, view);
    },
  };
}

/** `getData` on an unavailable flavor throws on some engines; treat as absent. */
function readFlavor(data: DataTransfer, flavor: string): string {
  try {
    return data.getData(flavor);
  } catch {
    return "";
  }
}

/**
 * One transaction = one undo entry. `state.replaceSelection` returns a full
 * spec object (`{changes, selection, effects}`) that covers every selection
 * range — dispatch it directly, the same way CodeMirror's own paste handler
 * does, instead of nesting it under `changes`.
 */
function insertAtomically(view: EditorView, markdown: string): void {
  view.dispatch(view.state.replaceSelection(markdown), {
    scrollIntoView: true,
    annotations: Transaction.userEvent.of("input.paste"),
  });
}

function writeMarkdownFlavor(event: ClipboardEvent, view: EditorView): void {
  const data = event.clipboardData;
  if (!data) return;
  const main = view.state.selection.main;
  if (main.empty) return;
  try {
    data.setData(MARKDOWN_MIME_TYPE, view.state.sliceDoc(main.from, main.to));
  } catch {
    // Read-only or synthetic clipboard payloads — nothing to enrich.
  }
}
