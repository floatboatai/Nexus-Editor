import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  EditorSelection,
  EditorState,
  Range,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { fuzzyMatch } from "@floatboat/nexus-core";

export interface FuzzyQuery {
  query: string;
  caseSensitive: boolean;
  fuzzy: boolean;
}

export const setFuzzyQuery = StateEffect.define<FuzzyQuery | null>();
export const setFuzzyActive = StateEffect.define<number>();

interface FuzzySpan {
  from: number;
  to: number;
  positions: number[];
}

interface FuzzyState {
  query: FuzzyQuery | null;
  spans: FuzzySpan[];
}

/**
 * Fuzzy matches are scoped per line (see `findFuzzyMatches`); the same
 * scoping is reused here so the live highlight and the programmatic
 * `findSearchMatches` agree on what a "match" is.
 */
function computeSpans(doc: string, q: FuzzyQuery): FuzzySpan[] {
  if (!q.fuzzy || !q.query) {
    return [];
  }
  const spans: FuzzySpan[] = [];
  let offset = 0;
  for (const line of doc.split("\n")) {
    const res = fuzzyMatch(q.query, line, { caseSensitive: q.caseSensitive });
    if (res.matched && res.positions.length > 0) {
      spans.push({
        from: offset + res.positions[0],
        to: offset + res.positions[res.positions.length - 1] + 1,
        positions: res.positions.map((p) => offset + p),
      });
    }
    offset += line.length + 1;
  }
  return spans;
}

const fuzzyStateField = StateField.define<FuzzyState>({
  create: () => ({ query: null, spans: [] }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFuzzyQuery)) {
        const q = e.value;
        return { query: q, spans: q ? computeSpans(tr.state.doc.toString(), q) : [] };
      }
    }
    if (value.query && tr.docChanged) {
      return { ...value, spans: computeSpans(tr.state.doc.toString(), value.query) };
    }
    return value;
  },
});

const fuzzyActiveField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFuzzyQuery)) {
        return 0;
      }
      if (e.is(setFuzzyActive)) {
        return e.value;
      }
    }
    return value;
  },
});

function buildDecorations(view: EditorView): DecorationSet {
  const { spans } = view.state.field(fuzzyStateField);
  const active = view.state.field(fuzzyActiveField);
  const ranges: Range<Decoration>[] = [];
  spans.forEach((span, i) => {
    const cls = i === active ? "cm-fuzzy-match-current" : "cm-fuzzy-match";
    for (const pos of span.positions) {
      if (pos + 1 <= view.state.doc.length) {
        ranges.push(Decoration.mark({ class: cls }).range(pos, pos + 1));
      }
    }
  });
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges, true);
}

const fuzzyDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.transactions.some((t) =>
          t.effects.some((e) => e.is(setFuzzyQuery) || e.is(setFuzzyActive))
        )
      ) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/** Move the active fuzzy match by `dir` (+1 next, -1 previous). Returns false when there are no matches. */
export function nexusFuzzyNavigate(view: EditorView, dir: 1 | -1): boolean {
  const { spans } = view.state.field(fuzzyStateField);
  if (spans.length === 0) {
    return false;
  }
  const current = view.state.field(fuzzyActiveField);
  const next = (current + dir + spans.length) % spans.length;
  const span = spans[next];
  view.dispatch({
    effects: setFuzzyActive.of(next),
    selection: { anchor: span.from, head: span.to },
  });
  view.focus();
  return true;
}

/** Select every fuzzy match as a multi-range selection. Returns false when there are no matches. */
export function nexusFuzzySelectAll(view: EditorView): boolean {
  const { spans } = view.state.field(fuzzyStateField);
  if (spans.length === 0) {
    return false;
  }
  const head = Math.min(view.state.field(fuzzyActiveField), spans.length - 1);
  const selection = EditorSelection.create(
    spans.map((s) => EditorSelection.range(s.from, s.to)),
    head
  );
  view.dispatch({ selection });
  return true;
}

export function fuzzySearchExtension(): Extension {
  // Allow the "select all matches" command to apply a multi-range selection.
  return [
    fuzzyStateField,
    fuzzyActiveField,
    fuzzyDecorationPlugin,
    EditorState.allowMultipleSelections.of(true)
  ];
}
