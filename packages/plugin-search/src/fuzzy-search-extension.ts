import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { findFuzzyMatchesInDocument } from "./fuzzy-match";

export interface FuzzySearchState {
  enabled: boolean;
  query: string;
  caseSensitive: boolean;
}

const EMPTY_FUZZY_STATE: FuzzySearchState = {
  enabled: false,
  query: "",
  caseSensitive: false
};

export const setFuzzySearchState = StateEffect.define<FuzzySearchState>();

export const fuzzySearchStateField = StateField.define<FuzzySearchState>({
  create: () => EMPTY_FUZZY_STATE,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFuzzySearchState)) {
        return effect.value;
      }
    }
    return value;
  }
});

function getFuzzyMatches(state: EditorState): Array<{ from: number; to: number }> {
  const fuzzyState = state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return [];
  }

  return findFuzzyMatchesInDocument(state.doc.toString(), fuzzyState.query, {
    caseSensitive: fuzzyState.caseSensitive
  });
}

function buildFuzzyDecorations(state: EditorState): DecorationSet {
  const fuzzyState = state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return Decoration.none;
  }

  const matches = getFuzzyMatches(state);
  if (matches.length === 0) {
    return Decoration.none;
  }

  const selectionFrom = Math.min(state.selection.main.anchor, state.selection.main.head);
  const selectionTo = Math.max(state.selection.main.anchor, state.selection.main.head);
  const decorations = matches.map((match) => {
    const isCurrent = match.from === selectionFrom && match.to === selectionTo;
    return Decoration.mark({
      class: isCurrent ? "cm-searchMatch cm-searchMatch-selected" : "cm-searchMatch"
    }).range(match.from, match.to);
  });

  return Decoration.set(decorations, true);
}

function selectFuzzyMatch(view: EditorView, index: number): boolean {
  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  const normalized = ((index % matches.length) + matches.length) % matches.length;
  const match = matches[normalized];
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    scrollIntoView: true
  });
  return true;
}

export function fuzzyFindNext(view: EditorView): boolean {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return false;
  }

  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  const cursor = view.state.selection.main.head;
  const nextIndex = matches.findIndex((match) => match.from > cursor);
  return selectFuzzyMatch(view, nextIndex >= 0 ? nextIndex : 0);
}

export function fuzzyFindPrevious(view: EditorView): boolean {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return false;
  }

  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  const cursor = view.state.selection.main.head;
  let previousIndex = -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from < cursor) {
      previousIndex = i;
    }
  }

  return selectFuzzyMatch(view, previousIndex >= 0 ? previousIndex : matches.length - 1);
}

export function fuzzySelectAll(view: EditorView): boolean {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return false;
  }

  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  view.dispatch({
    selection: matches.map((match) => ({
      anchor: match.from,
      head: match.to
    })),
    scrollIntoView: true
  });
  return true;
}

export function fuzzySearchExtension() {
  return [
    fuzzySearchStateField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildFuzzyDecorations(view.state);
        }

        update(update: ViewUpdate): void {
          const fuzzyChanged =
            update.state.field(fuzzySearchStateField) !== update.startState.field(fuzzySearchStateField);
          if (update.docChanged || update.selectionSet || fuzzyChanged) {
            this.decorations = buildFuzzyDecorations(update.state);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations }
    )
  ];
}
