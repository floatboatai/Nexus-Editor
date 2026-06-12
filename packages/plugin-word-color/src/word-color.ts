import { type Compartment, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export interface WordColorOptions {
  words: Record<string, string>;
  caseSensitive?: boolean;
}

export interface WordColorExtension {
  extension: Extension;
  reconfigure(next: WordColorOptions): { effects: any };
}

export function createWordColorExtension(opts: WordColorOptions): WordColorExtension {
  const compartment = new Compartment();
  return {
    extension: compartment.of(wordColorExtension(opts)),
    reconfigure(next: WordColorOptions) {
      return { effects: compartment.reconfigure(wordColorExtension(next)) };
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(words: string[], caseSensitive = false): RegExp | null {
  if (words.length === 0) return null;
  const pattern = words.map(escapeRegExp).join("|");
  const flags = caseSensitive ? "g" : "gi";
  return new RegExp(`\\b(?:${pattern})\\b`, flags);
}

function buildDecorations(view: EditorView, opts: WordColorOptions): DecorationSet {
  const doc = view.state.doc.toString();
  const words = Object.keys(opts.words || {});
  const re = buildRegex(words, !!opts.caseSensitive);
  if (!re) return Decoration.none;

  const cursorPos = view.state.selection.main.head;
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];

  for (const m of doc.matchAll(re)) {
    const text = m[0];
    const from = m.index ?? 0;
    const to = from + text.length;
    if (cursorPos >= from && cursorPos <= to) continue; // leave editable
    const key = opts.caseSensitive ? text : text.toLowerCase();
    const color = opts.words[key] ?? opts.words[text] ?? opts.words[text.toLowerCase()];
    if (!color) continue;
    const deco = Decoration.mark({ attributes: { style: `color: ${color}` } });
    decorations.push({ from, to, value: deco });
  }

  if (decorations.length === 0) return Decoration.none;
  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(decorations.map((d) => d.value.range(d.from, d.to)));
}

export function wordColorExtension(opts: WordColorOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, opts);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  return plugin;
}
