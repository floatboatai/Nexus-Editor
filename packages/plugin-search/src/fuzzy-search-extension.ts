import { Compartment, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  searchHighlightMatchesEqual,
  searchHighlightMatchesField,
  searchHighlightTheme,
  setSearchHighlightMatches,
  type SearchHighlightMatch
} from "@floatboat/nexus-core";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import {
  findFuzzyNextIndex,
  findFuzzyPreviousIndex,
  findFuzzyReplaceIndex
} from "./fuzzy-navigation";
import { findFuzzyMatchesInDocument, findLiteralMatchesInDocument } from "./fuzzy-match";

export interface FuzzySearchState {
  enabled: boolean;
  query: string;
  caseSensitive: boolean;
  /** When true, highlight literal substring matches instead of fuzzy tokens. */
  literal?: boolean;
}

const EMPTY_FUZZY_STATE: FuzzySearchState = {
  enabled: false,
  query: "",
  caseSensitive: false,
  literal: false
};

export const setFuzzySearchState = StateEffect.define<FuzzySearchState>();

export function fuzzySearchStateEquals(a: FuzzySearchState, b: FuzzySearchState): boolean {
  return (
    a.enabled === b.enabled &&
    a.query === b.query &&
    a.caseSensitive === b.caseSensitive &&
    (a.literal ?? false) === (b.literal ?? false)
  );
}

export const fuzzySearchStateField = StateField.define<FuzzySearchState>({
  create: () => EMPTY_FUZZY_STATE,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFuzzySearchState)) {
        const next = effect.value;
        return fuzzySearchStateEquals(value, next) ? value : next;
      }
    }
    return value;
  }
});

export const selectionHighlightCompartment = new Compartment();

function getFuzzyMatches(state: EditorState): Array<{ from: number; to: number }> {
  const fuzzyState = state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return [];
  }

  const doc = state.doc.toString();
  const options = { caseSensitive: fuzzyState.caseSensitive };
  if (fuzzyState.literal) {
    return findLiteralMatchesInDocument(doc, fuzzyState.query, options);
  }

  return findFuzzyMatchesInDocument(doc, fuzzyState.query, options);
}

export function syncSearchHighlights(
  editorRoot: Element | DocumentFragment | null,
  state: FuzzySearchState
): void {
  if (!editorRoot) {
    return;
  }

  const cmEditor =
    editorRoot instanceof Element && editorRoot.classList.contains("cm-editor")
      ? editorRoot
      : editorRoot.querySelector?.(".cm-editor");
  if (!cmEditor) {
    return;
  }

  const view = EditorView.findFromDOM(cmEditor as HTMLElement);
  if (!view || view.isDestroyed) {
    return;
  }

  const current = view.state.field(fuzzySearchStateField);
  if (!fuzzySearchStateEquals(current, state)) {
    view.dispatch({
      effects: setFuzzySearchState.of(state)
    });
  }
  scheduleSearchHighlightMatches(view);
}

function buildSearchHighlightMatches(
  state: EditorState,
  fuzzyState = state.field(fuzzySearchStateField)
): SearchHighlightMatch[] {
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return [];
  }

  const doc = state.doc.toString();
  const options = { caseSensitive: fuzzyState.caseSensitive };
  const matches = fuzzyState.literal
    ? findLiteralMatchesInDocument(doc, fuzzyState.query, options)
    : findFuzzyMatchesInDocument(doc, fuzzyState.query, options);
  const selectionFrom = Math.min(state.selection.main.anchor, state.selection.main.head);
  const selectionTo = Math.max(state.selection.main.anchor, state.selection.main.head);
  return matches.map((match) => ({
    from: match.from,
    to: match.to,
    selected: match.from === selectionFrom && match.to === selectionTo
  }));
}

export function searchHighlightEffectForState(
  state: EditorState,
  fuzzyState: FuzzySearchState
): ReturnType<typeof setSearchHighlightMatches.of> | null {
  const next = buildSearchHighlightMatches(state, fuzzyState);
  const current = state.field(searchHighlightMatchesField, false) ?? [];
  if (!searchHighlightMatchesEqual(current, next)) {
    return setSearchHighlightMatches.of(next);
  }
  return null;
}

export function dispatchSearchHighlightMatches(view: EditorView): void {
  const effect = searchHighlightEffectForState(view.state, view.state.field(fuzzySearchStateField));
  if (effect) {
    view.dispatch({ effects: effect });
  }
}

function scheduleSearchHighlightMatches(view: EditorView): void {
  queueMicrotask(() => {
    if (view.isDestroyed) {
      return;
    }
    dispatchSearchHighlightMatches(view);
  });
}

function selectFuzzyMatch(view: EditorView, index: number): boolean {
  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0 || index < 0) {
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

export function syncSelectionHighlight(view: EditorView, highlightSelectionMatchesEnabled: boolean): void {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  const suppress = fuzzyState.enabled && fuzzyState.query.length > 0;
  const wantHighlight = highlightSelectionMatchesEnabled && !suppress;
  const hasHighlight = selectionHighlightCompartment.get(view.state).length > 0;

  if (wantHighlight === hasHighlight) {
    return;
  }

  view.dispatch({
    effects: selectionHighlightCompartment.reconfigure(wantHighlight ? highlightSelectionMatches() : [])
  });
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

  const selectionFrom = Math.min(view.state.selection.main.anchor, view.state.selection.main.head);
  const selectionTo = Math.max(view.state.selection.main.anchor, view.state.selection.main.head);
  const cursor = view.state.selection.main.head;
  return selectFuzzyMatch(
    view,
    findFuzzyNextIndex(matches, selectionFrom, selectionTo, cursor)
  );
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

  const selectionFrom = Math.min(view.state.selection.main.anchor, view.state.selection.main.head);
  const selectionTo = Math.max(view.state.selection.main.anchor, view.state.selection.main.head);
  const cursor = view.state.selection.main.head;
  return selectFuzzyMatch(
    view,
    findFuzzyPreviousIndex(matches, selectionFrom, selectionTo, cursor)
  );
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

export function fuzzyReplaceNext(view: EditorView, replacement: string): boolean {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return false;
  }

  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  const selectionFrom = Math.min(view.state.selection.main.anchor, view.state.selection.main.head);
  const selectionTo = Math.max(view.state.selection.main.anchor, view.state.selection.main.head);
  const cursor = view.state.selection.main.head;
  const matchIndex = findFuzzyReplaceIndex(matches, selectionFrom, selectionTo, cursor);
  const match = matches[matchIndex];

  view.dispatch({
    changes: { from: match.from, to: match.to, insert: replacement },
    selection: { anchor: match.from + replacement.length },
    scrollIntoView: true
  });
  return fuzzyFindNext(view);
}

export function fuzzyReplaceAll(view: EditorView, replacement: string): boolean {
  const fuzzyState = view.state.field(fuzzySearchStateField);
  if (!fuzzyState.enabled || !fuzzyState.query) {
    return false;
  }

  const matches = getFuzzyMatches(view.state);
  if (matches.length === 0) {
    return false;
  }

  view.dispatch({
    changes: matches
      .slice()
      .reverse()
      .map((match) => ({
        from: match.from,
        to: match.to,
        insert: replacement
      })),
    scrollIntoView: true
  });
  return true;
}

export interface FuzzySearchExtensionOptions {
  highlightSelectionMatches?: boolean;
}

export function fuzzySearchExtension(options: FuzzySearchExtensionOptions = {}) {
  const highlightSelectionMatchesEnabled = options.highlightSelectionMatches ?? true;

  return [
    searchHighlightMatchesField,
    searchHighlightTheme,
    fuzzySearchStateField,
    selectionHighlightCompartment.of(
      highlightSelectionMatchesEnabled ? highlightSelectionMatches() : []
    ),
    ViewPlugin.fromClass(
      class {
        constructor(private readonly view: EditorView) {
          scheduleSearchHighlightMatches(this.view);
        }

        update(update: ViewUpdate): void {
          const fuzzyChanged =
            update.state.field(fuzzySearchStateField) !==
            update.startState.field(fuzzySearchStateField);
          if (update.docChanged || update.selectionSet || fuzzyChanged) {
            scheduleSearchHighlightMatches(update.view);
          }
        }
      }
    )
  ];
}
