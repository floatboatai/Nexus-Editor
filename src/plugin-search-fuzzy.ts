import { EditorView, ViewPlugin, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { getSearchQuery } from '@codemirror/search';
import { fuzzyMatch } from './fuzzy-match';

export const toggleFuzzyMode = StateEffect.define<boolean>();

const fuzzyModeField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleFuzzyMode)) {
        return effect.value;
      }
    }
    return value;
  },
});

const fuzzyMatchMark = Decoration.mark({
  class: 'cm-fuzzy-match',
});

const fuzzySearchPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: any) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    private computeDecorations(view: EditorView): DecorationSet {
      const decorations: any[] = [];

      const isFuzzyMode = view.state.field(fuzzyModeField);
      if (!isFuzzyMode) {
        return Decoration.set([]);
      }

      const query = getSearchQuery(view.state);
      if (!query || !query.search || query.search.length < 2) {
        return Decoration.set([]);
      }

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const results = fuzzyMatch(query.search, text, {
          caseSensitive: query.caseSensitive,
        });

        for (const result of results.slice(0, 100)) {
          const start = from + result.indices[0];
          const end = from + result.indices[result.indices.length - 1] + 1;

          decorations.push(fuzzyMatchMark.range(start, end));
        }
      }

      return Decoration.set(decorations, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export function fuzzySearch() {
  return [
    fuzzyModeField,
    fuzzySearchPlugin,
    EditorView.baseTheme({
      '.cm-fuzzy-match': {
        backgroundColor: 'rgba(255, 200, 0, 0.3)',
        borderRadius: '2px',
      },
    }),
  ];
}
