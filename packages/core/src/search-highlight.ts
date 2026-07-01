import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, type Range } from "@codemirror/view";

export interface SearchHighlightMatch {
  from: number;
  to: number;
  selected?: boolean;
}

export const setSearchHighlightMatches = StateEffect.define<SearchHighlightMatch[]>();

export const searchHighlightMatchesField = StateField.define<SearchHighlightMatch[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchHighlightMatches)) {
        return effect.value;
      }
    }
    return value;
  }
});

const SEARCH_MATCH_STYLE = "background-color:rgba(255,223,0,0.35);border-radius:2px";
const SEARCH_MATCH_SELECTED_STYLE = "background-color:rgba(255,180,0,0.55);border-radius:2px";

export function searchHighlightMatchesEqual(
  a: readonly SearchHighlightMatch[],
  b: readonly SearchHighlightMatch[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].from !== b[i].from ||
      a[i].to !== b[i].to ||
      !!a[i].selected !== !!b[i].selected
    ) {
      return false;
    }
  }
  return true;
}

function highlightStyleForMatch(match: SearchHighlightMatch): string {
  return match.selected ? SEARCH_MATCH_SELECTED_STYLE : SEARCH_MATCH_STYLE;
}

function highlightClassForMatch(match: SearchHighlightMatch): string {
  return match.selected ? "cm-searchMatch cm-searchMatch-selected" : "cm-searchMatch";
}

/** Stable key so live-preview widgets rebuild when search highlights change. */
export function serializeSearchHighlightKey(state: EditorState): string {
  const matches = state.field(searchHighlightMatchesField, false);
  if (!matches || matches.length === 0) {
    return "";
  }
  return matches.map((match) => `${match.from}:${match.to}:${match.selected ? 1 : 0}`).join(",");
}

/**
 * Append text (or highlighted spans) for a document range into `parent`.
 * Used by live-preview widgets whose source is hidden behind Decoration.replace.
 */
export function appendTextWithSearchHighlights(
  parent: Node,
  state: EditorState,
  text: string,
  from: number,
  to: number,
  onTextNode?: (node: Text, absFrom: number, absTo: number) => void
): void {
  const matches = (state.field(searchHighlightMatchesField, false) ?? [])
    .filter((match) => rangesOverlap(from, to, match.from, match.to))
    .sort((left, right) => left.from - right.from);

  if (matches.length === 0) {
    const node = document.createTextNode(text);
    onTextNode?.(node, from, to);
    parent.appendChild(node);
    return;
  }

  let cursor = from;
  let textOffset = 0;
  for (const match of matches) {
    const matchFrom = Math.max(from, match.from);
    const matchTo = Math.min(to, match.to);
    if (matchFrom >= matchTo) {
      continue;
    }

    if (matchFrom > cursor) {
      const plainLength = matchFrom - cursor;
      const node = document.createTextNode(text.slice(textOffset, textOffset + plainLength));
      onTextNode?.(node, cursor, matchFrom);
      parent.appendChild(node);
      textOffset += plainLength;
      cursor = matchFrom;
    }

    const highlightLength = matchTo - cursor;
    const span = document.createElement("span");
    span.className = highlightClassForMatch(match);
    span.style.cssText = highlightStyleForMatch(match);
    const highlighted = document.createTextNode(text.slice(textOffset, textOffset + highlightLength));
    onTextNode?.(highlighted, cursor, matchTo);
    span.appendChild(highlighted);
    parent.appendChild(span);
    textOffset += highlightLength;
    cursor = matchTo;
  }

  if (cursor < to) {
    const node = document.createTextNode(text.slice(textOffset));
    onTextNode?.(node, cursor, to);
    parent.appendChild(node);
  }
}

export function rangesOverlap(from: number, to: number, matchFrom: number, matchTo: number): boolean {
  return from < matchTo && matchFrom < to;
}

/** Extra inline style for a rendered widget span when it overlaps a search hit. */
export function searchHighlightStyleForRange(state: EditorState, from: number, to: number): string {
  const matches = state.field(searchHighlightMatchesField, false);
  if (!matches || matches.length === 0) {
    return "";
  }

  for (const match of matches) {
    if (rangesOverlap(from, to, match.from, match.to)) {
      return highlightStyleForMatch(match);
    }
  }
  return "";
}

export function appendSearchHighlightDecorations(
  state: EditorState,
  decos: Range<Decoration>[]
): void {
  const matches = state.field(searchHighlightMatchesField, false);
  if (!matches || matches.length === 0) {
    return;
  }

  for (const match of matches) {
    decos.push(
      Decoration.mark({
        class: highlightClassForMatch(match),
        attributes: { style: highlightStyleForMatch(match) }
      }).range(match.from, match.to)
    );
  }
}

function buildSearchHighlightDecorationSet(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  appendSearchHighlightDecorations(state, decos);
  return decos.length > 0 ? Decoration.set(decos, true) : Decoration.none;
}

export const searchHighlightTheme = EditorView.baseTheme({
  ".cm-searchMatch": {
    backgroundColor: "rgba(255, 223, 0, 0.35)",
    borderRadius: "2px"
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "rgba(255, 180, 0, 0.55)"
  }
});

/** Standalone search highlights when live preview is disabled. */
export function createSearchHighlightDecorationExtension(): Extension[] {
  const decorationField = StateField.define<DecorationSet>({
    create(state) {
      return buildSearchHighlightDecorationSet(state);
    },
    update(decos, transaction) {
      if (
        transaction.state.field(searchHighlightMatchesField) !==
        transaction.startState.field(searchHighlightMatchesField)
      ) {
        return buildSearchHighlightDecorationSet(transaction.state);
      }
      return transaction.docChanged ? decos.map(transaction.changes) : decos;
    },
    provide: (field) => EditorView.decorations.from(field)
  });

  return [searchHighlightTheme, decorationField];
}
