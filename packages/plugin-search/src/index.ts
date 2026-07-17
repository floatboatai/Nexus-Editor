import {
  closeSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery
} from "@codemirror/search";
import {
  Decoration,
  EditorView,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  type DecorationSet,
  type Panel,
  type ViewUpdate
} from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface SearchMatch {
  from: number;
  to: number;
  text: string;
}

export interface FuzzySearchMatch extends SearchMatch {
  positions: number[];
  score: number;
}

export interface FuzzySearchOptions {
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}

export interface SearchHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface SearchHistoryOptions {
  storage?: SearchHistoryStorage;
  storageKey?: string;
  maxEntries?: number;
}

export interface SearchPluginOptions {
  /**
   * Render the search panel above the editor content. Defaults to true.
   */
  top?: boolean;
  /**
   * Enable case-sensitive search by default.
   */
  caseSensitive?: boolean;
  /**
   * Highlight viewport matches for the current selection.
   */
  highlightSelectionMatches?: boolean;
  /**
   * Opt-in search query history. Pass storage explicitly to persist entries.
   */
  history?: boolean | SearchHistoryOptions;
  labels?: Partial<SearchPluginLabels>;
}

export interface SearchPluginLabels {
  find: string;
  replace: string;
  next: string;
  previous: string;
  fuzzy?: string;
  replaceNext: string;
  replaceAll: string;
  close: string;
  noFuzzyMatches?: string;

  /** @deprecated The search panel no longer renders this control. */
  showReplace?: string;
  /** @deprecated The search panel no longer renders this control. */
  hideReplace?: string;
  /** @deprecated The search panel no longer renders this control. */
  all?: string;
  /** @deprecated The search panel no longer renders this control. */
  matchCase?: string;
  /** @deprecated The search panel no longer renders this control. */
  regexp?: string;
  /** @deprecated The search panel no longer renders this control. */
  byWord?: string;
}

type ResolvedSearchPluginLabels = Required<
  Pick<
    SearchPluginLabels,
    | "find"
    | "replace"
    | "next"
    | "previous"
    | "fuzzy"
    | "replaceNext"
    | "replaceAll"
    | "close"
    | "noFuzzyMatches"
  >
>;

const DEFAULT_LABELS: ResolvedSearchPluginLabels = {
  find: "Find",
  replace: "Replace",
  next: "Next",
  previous: "Previous",
  fuzzy: "Fuzzy",
  replaceNext: "Replace",
  replaceAll: "Replace all",
  close: "Close",
  noFuzzyMatches: "No fuzzy matches"
};

const DEFAULT_SEARCH_HISTORY_KEY = "nexus.search.history";
const DEFAULT_SEARCH_HISTORY_MAX_ENTRIES = 20;
const TABLE_SEARCH_CELL_SELECTOR = ".nexus-table-wrapper .nexus-cell";
const TABLE_SEARCH_HIGHLIGHT_PREFIX = "nexus-table-search";
const SEARCH_LINK_MATCH_ATTRIBUTE = "data-nexus-search-link-match";
const DEFAULT_FUZZY_MAX_RESULTS = 1_000;

let nextTableSearchHighlightId = 0;

type SearchHistoryDirection = "previous" | "next";

type CssHighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

interface TableSearchHighlightNames {
  match: string;
  selected: string;
  styleId: string;
}

interface TextRange {
  from: number;
  to: number;
}

interface RenderedSearchMatch extends SearchMatch {
  sourceFrom: number;
  sourceTo: number;
}

interface TableSearchCell {
  element: HTMLElement;
  rendered: string;
  sourceFrom: number;
  sourceTo: number;
  segments: RenderedSourceSegment[];
}

interface RenderedTableSearchMatch extends RenderedSearchMatch {
  cell: HTMLElement;
}

interface RenderedSourceSegment {
  renderedFrom: number;
  renderedTo: number;
  sourceFrom: number;
  sourceTo: number;
}

function getCssHighlightSupport(doc: Document):
  | {
      registry: CssHighlightRegistry;
      Highlight: HighlightConstructor;
    }
  | null {
  const win = doc.defaultView as
    | (Window & {
        CSS?: { highlights?: CssHighlightRegistry };
        Highlight?: HighlightConstructor;
      })
    | null;
  const registry = win?.CSS?.highlights;
  const HighlightCtor = win?.Highlight;

  if (!registry || typeof registry.set !== "function" || typeof registry.delete !== "function") {
    return null;
  }
  if (typeof HighlightCtor !== "function") {
    return null;
  }

  return { registry, Highlight: HighlightCtor };
}

function createTableSearchHighlightNames(): TableSearchHighlightNames {
  const id = ++nextTableSearchHighlightId;
  return {
    match: `${TABLE_SEARCH_HIGHLIGHT_PREFIX}-${id}-match`,
    selected: `${TABLE_SEARCH_HIGHLIGHT_PREFIX}-${id}-selected`,
    styleId: `${TABLE_SEARCH_HIGHLIGHT_PREFIX}-${id}-style`
  };
}

function createTableSearchHighlightStyles(
  doc: Document,
  names: TableSearchHighlightNames
): HTMLStyleElement {
  const style = doc.createElement("style");
  style.id = names.styleId;
  style.dataset.nexusTableSearchHighlight = "true";
  style.textContent = `
::highlight(${names.match}) {
  background-color: rgba(255, 214, 10, 0.38);
  color: inherit;
}
::highlight(${names.selected}) {
  background-color: rgba(255, 177, 0, 0.68);
  color: inherit;
}
`;
  doc.head.appendChild(style);
  return style;
}

function createTextRanges(root: Element, from: number, to: number): Range[] {
  if (from >= to) return [];

  const doc = root.ownerDocument;
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? "";
    const nextOffset = offset + text.length;
    const startsBeforeMatchEnd = offset < to;
    const endsAfterMatchStart = nextOffset > from;

    if (text.length > 0 && startsBeforeMatchEnd && endsAfterMatchStart) {
      const range = doc.createRange();
      range.setStart(node, Math.max(0, from - offset));
      range.setEnd(node, Math.min(text.length, to - offset));
      ranges.push(range);
    }

    offset = nextOffset;
    if (offset >= to) break;
  }

  return ranges;
}

function mergeTextRanges(ranges: readonly TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of [...ranges].sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function clearLinkTextHighlights(root: Element): void {
  const affectedLinks = new Set<HTMLElement>();
  for (const marker of Array.from(
    root.querySelectorAll<HTMLElement>(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)
  )) {
    const link = marker.closest<HTMLElement>("[data-link-url]");
    if (link) affectedLinks.add(link);
    marker.replaceWith(...Array.from(marker.childNodes));
  }
  for (const link of affectedLinks) link.normalize();
}

function highlightLinkTextRanges(
  root: HTMLElement,
  ranges: readonly TextRange[],
  activeRanges: readonly TextRange[] = []
): void {
  const mergedRanges = mergeTextRanges(ranges);
  if (mergedRanges.length === 0) return;
  const mergedActiveRanges = mergeTextRanges(activeRanges);

  const doc = root.ownerDocument;
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let offset = 0;
  for (const node of textNodes) {
    const text = node.data;
    const nextOffset = offset + text.length;
    const nodeRanges = mergedRanges
      .filter((range) => range.from < nextOffset && range.to > offset)
      .map((range) => ({
        from: Math.max(0, range.from - offset),
        to: Math.min(text.length, range.to - offset)
      }));

    if (nodeRanges.length > 0) {
      const fragment = doc.createDocumentFragment();
      let cursor = 0;
      for (const range of nodeRanges) {
        const boundaries = [range.from, range.to];
        for (const activeRange of mergedActiveRanges) {
          const activeFrom = Math.max(range.from, activeRange.from - offset);
          const activeTo = Math.min(range.to, activeRange.to - offset);
          if (activeFrom < activeTo) boundaries.push(activeFrom, activeTo);
        }

        boundaries.sort((left, right) => left - right);
        for (let index = 0; index < boundaries.length - 1; index++) {
          const from = boundaries[index];
          const to = boundaries[index + 1];
          if (from === to) continue;
          if (cursor < from) fragment.append(text.slice(cursor, from));
          const marker = doc.createElement("span");
          const active = mergedActiveRanges.some(
            (activeRange) => activeRange.from <= offset + from && activeRange.to >= offset + to
          );
          marker.className = active
            ? `${SEARCH_LINK_MATCH_CLASS} ${SEARCH_LINK_ACTIVE_MATCH_CLASS}`
            : SEARCH_LINK_MATCH_CLASS;
          marker.dataset.nexusSearchLinkMatch = "true";
          marker.textContent = text.slice(from, to);
          fragment.append(marker);
          cursor = to;
        }
      }
      if (cursor < text.length) fragment.append(text.slice(cursor));
      node.replaceWith(fragment);
    }

    offset = nextOffset;
  }
}

function readNumericDatasetValue(element: HTMLElement, key: string): number | null {
  const value = element.dataset[key];
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRenderedSourceSegments(cell: HTMLElement): RenderedSourceSegment[] {
  const encoded = cell.dataset.renderedSourceMap;
  if (!encoded) return [];
  try {
    const value = JSON.parse(encoded) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((segment): segment is RenderedSourceSegment => {
      if (!segment || typeof segment !== "object") return false;
      const candidate = segment as Partial<RenderedSourceSegment>;
      return (
        Number.isInteger(candidate.renderedFrom) &&
        Number.isInteger(candidate.renderedTo) &&
        Number.isInteger(candidate.sourceFrom) &&
        Number.isInteger(candidate.sourceTo) &&
        candidate.renderedFrom! >= 0 &&
        candidate.renderedTo! >= candidate.renderedFrom! &&
        candidate.sourceFrom! >= 0 &&
        candidate.sourceTo! >= candidate.sourceFrom!
      );
    });
  } catch {
    return [];
  }
}

function mapSourceRangeToRendered(
  segments: RenderedSourceSegment[],
  sourceFrom: number,
  sourceTo: number
): { from: number; to: number } | null {
  if (sourceTo <= sourceFrom) return null;
  let sourceCursor = sourceFrom;
  let renderedFrom: number | null = null;
  let renderedCursor = -1;

  for (const segment of segments) {
    if (segment.sourceTo <= sourceCursor) continue;
    if (segment.sourceFrom > sourceCursor) return null;
    const sourceLength = segment.sourceTo - segment.sourceFrom;
    const renderedLength = segment.renderedTo - segment.renderedFrom;
    if (sourceLength !== renderedLength) return null;

    const partSourceTo = Math.min(sourceTo, segment.sourceTo);
    const partRenderedFrom = segment.renderedFrom + sourceCursor - segment.sourceFrom;
    const partRenderedTo = segment.renderedFrom + partSourceTo - segment.sourceFrom;
    if (renderedFrom === null) renderedFrom = partRenderedFrom;
    else if (partRenderedFrom !== renderedCursor) return null;

    renderedCursor = partRenderedTo;
    sourceCursor = partSourceTo;
    if (sourceCursor === sourceTo) {
      return { from: renderedFrom, to: renderedCursor };
    }
  }

  return null;
}

function readTableSearchCell(view: EditorView, cell: HTMLElement): TableSearchCell | null {
  const source = cell.dataset.source;
  const sourceFrom = readNumericDatasetValue(cell, "sourceFrom");
  const sourceTo = readNumericDatasetValue(cell, "sourceTo");
  if (source === undefined || sourceFrom === null || sourceTo === null) return null;
  if (sourceTo - sourceFrom !== source.length) return null;
  if (view.state.sliceDoc(sourceFrom, sourceTo) !== source) return null;

  const rendered = cell.textContent ?? "";
  if (!rendered) return null;
  const segments = readRenderedSourceSegments(cell);
  if (segments.length === 0) return null;

  return { element: cell, rendered, sourceFrom, sourceTo, segments };
}

function findRenderedTableSearchMatches(
  view: EditorView,
  query: SearchQuery
): RenderedTableSearchMatch[] {
  const cells = Array.from(view.dom.querySelectorAll<HTMLElement>(TABLE_SEARCH_CELL_SELECTOR))
    .filter((cell) => !cell.isContentEditable)
    .map((cell) => readTableSearchCell(view, cell))
    .filter((cell): cell is TableSearchCell => cell !== null)
    .sort((a, b) => a.sourceFrom - b.sourceFrom);
  if (cells.length === 0) return [];

  const renderedMatches: RenderedTableSearchMatch[] = [];
  const sourceCursor = query.getCursor(view.state);
  let cellIndex = 0;
  for (let result = sourceCursor.next(); !result.done; result = sourceCursor.next()) {
    const absoluteFrom = result.value.from;
    const absoluteTo = result.value.to;
    if (absoluteTo <= absoluteFrom) continue;
    while (cellIndex < cells.length && cells[cellIndex].sourceTo <= absoluteFrom) cellIndex++;
    if (cellIndex >= cells.length) break;

    let cell: TableSearchCell | null = null;
    for (let index = cellIndex; index < cells.length && cells[index].sourceFrom < absoluteTo; index++) {
      const candidate = cells[index];
      if (absoluteFrom >= candidate.sourceFrom && absoluteTo <= candidate.sourceTo) {
        cell = candidate;
        break;
      }
    }
    if (!cell) continue;

    const mapped = mapSourceRangeToRendered(
      cell.segments,
      absoluteFrom - cell.sourceFrom,
      absoluteTo - cell.sourceFrom
    );
    if (!mapped || mapped.to > cell.rendered.length) continue;
    const sourceText = view.state.sliceDoc(absoluteFrom, absoluteTo);
    if (cell.rendered.slice(mapped.from, mapped.to) !== sourceText) continue;

    renderedMatches.push({
      cell: cell.element,
      from: mapped.from,
      to: mapped.to,
      text: cell.rendered.slice(mapped.from, mapped.to),
      sourceFrom: absoluteFrom,
      sourceTo: absoluteTo
    });
  }

  return renderedMatches;
}

function isSelectedSearchMatch(
  match: RenderedSearchMatch,
  selections: readonly { from: number; to: number }[]
): boolean {
  return selections.some(
    (selection) => match.sourceFrom === selection.from && match.sourceTo === selection.to
  );
}

class TableSearchHighlighter {
  private readonly names = createTableSearchHighlightNames();
  private registry: CssHighlightRegistry | null = null;
  private style: HTMLStyleElement | null = null;
  private syncScheduled = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.sync();
  }

  sync(): void {
    if (this.destroyed) return;
    const doc = this.view.dom.ownerDocument;
    const support = getCssHighlightSupport(doc);
    if (!support) {
      this.clear();
      return;
    }

    if (this.registry && this.registry !== support.registry) {
      this.registry.delete(this.names.match);
      this.registry.delete(this.names.selected);
    }
    this.registry = support.registry;

    const query = getSearchQuery(this.view.state);
    if (!searchPanelOpen(this.view.state) || !query.valid) {
      this.clear();
      return;
    }

    if (!this.style?.isConnected) {
      this.style = createTableSearchHighlightStyles(doc, this.names);
    }

    const selections = this.view.state.selection.ranges.map((selection) => ({
      from: selection.from,
      to: selection.to,
    }));
    const matchRanges: Range[] = [];
    const selectedRanges: Range[] = [];

    for (const match of findRenderedTableSearchMatches(this.view, query)) {
      const ranges = createTextRanges(match.cell, match.from, match.to);
      if (isSelectedSearchMatch(match, selections)) {
        selectedRanges.push(...ranges);
      } else {
        matchRanges.push(...ranges);
      }
    }

    if (matchRanges.length > 0) {
      support.registry.set(this.names.match, new support.Highlight(...matchRanges));
    } else {
      support.registry.delete(this.names.match);
    }

    if (selectedRanges.length > 0) {
      support.registry.set(this.names.selected, new support.Highlight(...selectedRanges));
    } else {
      support.registry.delete(this.names.selected);
    }
  }

  scheduleSync(): void {
    if (this.destroyed || this.syncScheduled) return;
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      this.sync();
    });
  }

  clear(): void {
    this.registry?.delete(this.names.match);
    this.registry?.delete(this.names.selected);
    this.style?.remove();
    this.style = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.registry = null;
  }
}

const tableSearchHighlightPlugin = ViewPlugin.fromClass(
  class {
    private readonly highlighter: TableSearchHighlighter;

    constructor(view: EditorView) {
      this.highlighter = new TableSearchHighlighter(view);
    }

    update(update: ViewUpdate): void {
      const searchQueryChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setSearchQuery))
      );
      const searchPanelChanged = searchPanelOpen(update.startState) !== searchPanelOpen(update.state);
      if (update.docChanged || update.viewportChanged) {
        this.highlighter.scheduleSync();
      } else if (update.selectionSet || searchQueryChanged || searchPanelChanged) {
        this.highlighter.sync();
      }
    }

    destroy(): void {
      this.highlighter.destroy();
    }
  }
);

interface FuzzySearchState {
  enabled: boolean;
  query: string;
  caseSensitive: boolean;
}

const FUZZY_MATCH_CLASS = "nexus-search-fuzzy-match";
const FUZZY_ACTIVE_MATCH_CLASS = "nexus-search-fuzzy-match-active";
const SEARCH_ACTIVE_MATCH_CLASS = "nexus-search-active-match";
const SEARCH_LINK_MATCH_CLASS = "nexus-search-link-match";
const SEARCH_LINK_ACTIVE_MATCH_CLASS = "nexus-search-link-match-active";

class FuzzySearchHighlighter {
  decorations: DecorationSet = Decoration.none;
  private state: FuzzySearchState = {
    enabled: false,
    query: "",
    caseSensitive: false
  };
  private matches: FuzzySearchMatch[] = [];
  private activeMatch: FuzzySearchMatch | null = null;
  private navigationIndex = -1;
  private literalQuery: SearchQuery | null = null;
  private activeLiteralMatch: SearchMatch | null = null;
  private linkHighlightSyncScheduled = false;
  private linkHighlightMeasureScheduled = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {}

  get resultCount(): number {
    return this.matches.length;
  }

  configure(state: FuzzySearchState): void {
    const changed =
      state.enabled !== this.state.enabled ||
      state.query !== this.state.query ||
      state.caseSensitive !== this.state.caseSensitive;
    if (!changed) return;

    this.state = state;
    this.rebuildMatches();
  }

  configureLiteral(query: SearchQuery | null): void {
    if ((query === null && this.literalQuery === null) || (query && this.literalQuery?.eq(query))) {
      return;
    }

    this.literalQuery = query;
    this.rebuildLiteralMatches();
  }

  update(update: ViewUpdate): void {
    if (!searchPanelOpen(update.state)) {
      this.state = { enabled: false, query: "", caseSensitive: false };
      this.matches = [];
      this.activeMatch = null;
      this.navigationIndex = -1;
      this.literalQuery = null;
      this.activeLiteralMatch = null;
      this.rebuildDecorations();
      this.clearLinkHighlights();
      return;
    }

    if (update.docChanged) {
      if (this.state.enabled) this.rebuildMatches();
      else if (this.literalQuery?.valid) this.rebuildLiteralMatches();
    } else if (this.state.enabled || this.literalQuery?.valid) {
      this.scheduleLinkHighlightSync();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearLinkHighlights();
  }

  navigate(direction: "next" | "previous"): boolean {
    if (this.matches.length === 0) return false;

    const matches = [...this.matches].sort((left, right) => left.from - right.from || left.to - right.to);
    const offset = direction === "next" ? 1 : -1;
    const fallback = direction === "next" ? 0 : this.matches.length - 1;
    const index = (this.navigationIndex + offset + matches.length) % matches.length;
    this.navigationIndex = this.navigationIndex === -1 ? fallback : index;
    const match = matches[this.navigationIndex];
    this.activeMatch = match;
    this.rebuildDecorations();

    this.view.dispatch({
      effects: EditorView.scrollIntoView(match.from, { y: "center" })
    });
    return true;
  }

  navigateLiteral(direction: "next" | "previous"): boolean {
    const query = this.literalQuery;
    if (!query?.valid) return false;

    const match =
      direction === "next"
        ? this.findNextLiteralMatch(query, this.activeLiteralMatch?.to ?? 0) ??
          this.findNextLiteralMatch(query, 0)
        : this.findPreviousLiteralMatch(query, this.activeLiteralMatch?.from ?? this.view.state.doc.length) ??
          this.findPreviousLiteralMatch(query, this.view.state.doc.length);
    if (!match) return false;

    this.activeLiteralMatch = match;
    this.rebuildDecorations();

    this.view.dispatch({
      effects: EditorView.scrollIntoView(match.from, { y: "center" })
    });
    return true;
  }

  private rebuildMatches(): void {
    this.activeMatch = null;
    this.navigationIndex = -1;
    this.matches = this.state.enabled
      ? findFuzzyMatches(this.view.state.doc.toString(), this.state.query, {
          caseSensitive: this.state.caseSensitive
        })
      : [];

    this.rebuildDecorations();
    this.scheduleLinkHighlightSync();
  }

  private rebuildLiteralMatches(): void {
    this.activeLiteralMatch = null;
    this.rebuildDecorations();
    this.scheduleLinkHighlightSync();
  }

  private findNextLiteralMatch(query: SearchQuery, from: number): SearchMatch | null {
    const next = query.getCursor(this.view.state, from).next();
    return next.done ? null : this.createLiteralMatch(next.value.from, next.value.to);
  }

  private findPreviousLiteralMatch(query: SearchQuery, before: number): SearchMatch | null {
    const cursor = query.getCursor(this.view.state, 0, before);
    let previous: SearchMatch | null = null;
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      if (next.value.to <= before) {
        previous = this.createLiteralMatch(next.value.from, next.value.to);
      }
    }
    return previous;
  }

  private createLiteralMatch(from: number, to: number): SearchMatch {
    return { from, to, text: this.view.state.sliceDoc(from, to) };
  }

  private rebuildDecorations(): void {
    const positions = new Set<number>();
    for (const match of this.matches) {
      for (const position of match.positions) positions.add(position);
    }
    const activePositions = new Set(this.activeMatch?.positions);
    const decorations = Array.from(positions)
      .sort((a, b) => a - b)
      .map((position) =>
        Decoration.mark({
          class: activePositions.has(position)
            ? `${FUZZY_MATCH_CLASS} ${FUZZY_ACTIVE_MATCH_CLASS}`
            : FUZZY_MATCH_CLASS
        }).range(position, position + 1)
      );
    if (this.activeLiteralMatch) {
      decorations.push(
        Decoration.mark({ class: SEARCH_ACTIVE_MATCH_CLASS }).range(
          this.activeLiteralMatch.from,
          this.activeLiteralMatch.to
        )
      );
    }

    this.decorations = Decoration.set(
      decorations.sort((left, right) => left.from - right.from),
      true
    );
  }

  private scheduleLinkHighlightSync(): void {
    if (this.destroyed) return;

    if (!this.linkHighlightSyncScheduled) {
      this.linkHighlightSyncScheduled = true;
      queueMicrotask(() => {
        this.linkHighlightSyncScheduled = false;
        this.syncLinkHighlights();
      });
    }

    if (this.linkHighlightMeasureScheduled) return;
    this.linkHighlightMeasureScheduled = true;
    this.view.requestMeasure({
      read: () => null,
      write: () => {
        this.linkHighlightMeasureScheduled = false;
        this.syncLinkHighlights();
      }
    });
  }

  private syncLinkHighlights(): void {
    if (this.destroyed) return;

    const fuzzyActive = this.state.enabled && this.state.query;
    const literalQuery = this.literalQuery?.valid ? this.literalQuery : null;
    clearLinkTextHighlights(this.view.dom);
    if (!fuzzyActive && !literalQuery) {
      return;
    }

    for (const link of Array.from(this.view.dom.querySelectorAll<HTMLElement>("[data-link-url]"))) {
      const linkRanges: TextRange[] = [];
      if (fuzzyActive) {
        const positions = new Set<number>();
        for (const match of findFuzzyMatches(link.textContent ?? "", this.state.query, {
          caseSensitive: this.state.caseSensitive
        })) {
          for (const position of match.positions) positions.add(position);
        }
        for (const position of positions) {
          linkRanges.push({ from: position, to: position + 1 });
        }
      } else if (literalQuery) {
        for (const match of findSearchMatches(link.textContent ?? "", literalQuery.search, {
          caseSensitive: literalQuery.caseSensitive,
          regexp: literalQuery.regexp,
          wholeWord: literalQuery.wholeWord
        })) {
          linkRanges.push({ from: match.from, to: match.to });
        }
      }

      highlightLinkTextRanges(
        link,
        linkRanges,
        this.getActiveLinkRanges(link)
      );
    }
  }

  private getActiveLinkRanges(link: HTMLElement): TextRange[] {
    const activeMatch = this.activeMatch ?? this.activeLiteralMatch;
    if (!activeMatch) return [];

    const url = link.dataset.linkUrl;
    if (!url) return [];
    const line = this.view.state.doc.lineAt(activeMatch.from);
    if (activeMatch.to > line.to) return [];

    for (let urlIndex = line.text.indexOf(url); urlIndex >= 0; urlIndex = line.text.indexOf(url, urlIndex + url.length)) {
      const urlFrom = line.from + urlIndex;
      const urlTo = urlFrom + url.length;
      const label = link.textContent ?? "";
      const labelIndex = line.text.lastIndexOf(`[${label}](`, urlIndex);
      if (labelIndex >= 0) {
        const labelFrom = line.from + labelIndex + 1;
        const labelTo = labelFrom + label.length;
        if (activeMatch.from >= labelFrom && activeMatch.to <= labelTo) {
          return this.mapActiveMatchToLinkRanges(activeMatch, labelFrom);
        }
      }
      if (activeMatch.from >= urlFrom && activeMatch.to <= urlTo) {
        return this.mapActiveMatchToLinkRanges(activeMatch, urlFrom);
      }
    }

    return [];
  }

  private mapActiveMatchToLinkRanges(activeMatch: SearchMatch, sourceFrom: number): TextRange[] {
    if (this.activeMatch) {
      return this.activeMatch.positions.map((position) => ({
        from: position - sourceFrom,
        to: position - sourceFrom + 1
      }));
    }

    return [{ from: activeMatch.from - sourceFrom, to: activeMatch.to - sourceFrom }];
  }

  private clearLinkHighlights(): void {
    clearLinkTextHighlights(this.view.dom);
  }
}

const fuzzySearchHighlighter = ViewPlugin.fromClass(FuzzySearchHighlighter, {
  decorations: (value) => value.decorations
});

const fuzzySearchTheme = EditorView.baseTheme({
  "&": {
    "--nexus-search-bg": "var(--nexus-bg-subtle, #f6f8fa)",
    "--nexus-search-surface": "var(--nexus-bg, #ffffff)",
    "--nexus-search-muted": "var(--nexus-bg-muted, #eef1f4)",
    "--nexus-search-border": "var(--nexus-border, #d8dee4)",
    "--nexus-search-text": "var(--nexus-text, #24292f)",
    "--nexus-search-text-muted": "var(--nexus-text-muted, #66707b)",
    "--nexus-search-accent": "var(--nexus-accent, #0969da)",
    "--nexus-search-fuzzy-match-bg":
      "rgba(255, 214, 10, 0.38)",
    "--nexus-search-fuzzy-active-match-bg": "rgba(255, 177, 0, 0.68)",
    "--nexus-search-active-match-bg": "rgba(255, 177, 0, 0.68)",
    "--nexus-search-fuzzy-match-radius": "3px",
    "--nexus-search-fuzzy-transition": "140ms",
    "--nexus-search-status-color": "var(--nexus-search-text-muted)",
    "--nexus-search-status-font-size": "12px"
  },
  ".nexus-search-panel": {
    position: "relative",
    display: "block",
    boxSizing: "border-box",
    minHeight: "43px",
    padding: "6px 0 0 !important",
    background: "var(--nexus-search-bg)",
    color: "var(--nexus-search-text)",
    borderBottom: "0",
    fontFamily: "var(--nexus-font, system-ui, -apple-system, 'Segoe UI', sans-serif)",
    fontSize: "13px",
    lineHeight: "1",
    overflowX: "hidden",
    overflowY: "hidden"
  },
  ".cm-panels.cm-panels-top:has(.nexus-search-panel)": {
    borderBottom: "0"
  },
  ".nexus-search-panel .nexus-search-row": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: "4px",
    minWidth: "0",
    width: "100%",
    maxWidth: "100%",
    padding: "0 8px 7px 10px",
    overflowX: "auto",
    overflowY: "hidden",
    whiteSpace: "nowrap"
  },
  ".nexus-search-panel [hidden]": {
    display: "none"
  },
  ".nexus-search-panel .cm-textfield": {
    boxSizing: "border-box",
    flex: "1 1 180px",
    minWidth: "90px",
    maxWidth: "300px",
    width: "clamp(140px, 22vw, 300px)",
    height: "30px",
    margin: "0 !important",
    padding: "0 9px",
    border: "1px solid var(--nexus-search-border)",
    borderRadius: "4px",
    outline: "none",
    background: "var(--nexus-search-surface)",
    color: "var(--nexus-search-text)",
    font: "inherit",
    lineHeight: "28px",
    transition:
      "border-color var(--nexus-search-fuzzy-transition) ease, box-shadow var(--nexus-search-fuzzy-transition) ease, background-color var(--nexus-search-fuzzy-transition) ease"
  },
  ".nexus-search-panel .cm-textfield::placeholder": {
    color: "var(--nexus-search-text-muted)",
    opacity: "0.78"
  },
  ".nexus-search-panel .cm-textfield:focus": {
    borderColor: "var(--nexus-search-accent)",
    boxShadow:
      "0 0 0 2px color-mix(in srgb, var(--nexus-search-accent) 18%, transparent)"
  },
  ".nexus-search-panel .nexus-search-button-group": {
    display: "inline-flex",
    alignItems: "center",
    flex: "0 0 auto",
    gap: "0"
  },
  ".nexus-search-divider": {
    alignSelf: "center",
    flex: "0 0 1px",
    width: "1px",
    height: "18px",
    margin: "0 4px",
    background: "var(--nexus-border-subtle, var(--nexus-search-border))"
  },
  ".nexus-search-panel .cm-button": {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 30px",
    width: "30px",
    height: "30px",
    margin: "0 !important",
    padding: "0",
    border: "0",
    borderRadius: "4px",
    outline: "none",
    background: "transparent",
    color: "var(--nexus-search-text-muted)",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1",
    transition:
      "background-color var(--nexus-search-fuzzy-transition) ease, color var(--nexus-search-fuzzy-transition) ease, transform var(--nexus-search-fuzzy-transition) ease, opacity var(--nexus-search-fuzzy-transition) ease"
  },
  ".nexus-search-panel .cm-button:hover:not(:disabled)": {
    background: "var(--nexus-search-muted)",
    color: "var(--nexus-search-text)"
  },
  ".nexus-search-panel .cm-button:active:not(:disabled)": {
    transform: "scale(0.96)"
  },
  ".nexus-search-panel .cm-button:focus-visible": {
    outline: "2px solid var(--nexus-search-accent)",
    outlineOffset: "1px"
  },
  ".nexus-search-panel .cm-button:disabled": {
    cursor: "not-allowed",
    opacity: "0.36"
  },
  ".nexus-search-panel .cm-button svg": {
    width: "18px",
    height: "18px"
  },
  ".nexus-search-panel .nexus-search-text-button": {
    flex: "0 0 auto",
    width: "auto",
    minWidth: "30px",
    padding: "0 6px",
    fontWeight: "500",
    whiteSpace: "nowrap"
  },
  ".nexus-search-panel .cm-button[name='select']": {
    fontWeight: "600"
  },
  ".nexus-search-panel .nexus-search-icon-button[data-active='true']": {
    background: "var(--nexus-search-muted)",
    color: "var(--nexus-search-accent)"
  },
  ".nexus-search-panel .cm-button[name='close']": {
    position: "static",
    top: "auto",
    right: "auto",
    alignSelf: "center",
    flex: "0 0 30px",
    color: "var(--nexus-search-text-muted)"
  },
  ".nexus-search-button-wrap": {
    display: "inline-flex",
    flex: "0 0 auto"
  },
  [`.${FUZZY_MATCH_CLASS}`]: {
    backgroundColor: "var(--nexus-search-fuzzy-match-bg)",
    borderRadius: "var(--nexus-search-fuzzy-match-radius)",
    transition: "background-color var(--nexus-search-fuzzy-transition) ease"
  },
  [`.${FUZZY_ACTIVE_MATCH_CLASS}`]: {
    backgroundColor: "var(--nexus-search-fuzzy-active-match-bg)"
  },
  [`.${SEARCH_ACTIVE_MATCH_CLASS}`]: {
    backgroundColor: "var(--nexus-search-active-match-bg)",
    borderRadius: "var(--nexus-search-fuzzy-match-radius)"
  },
  [`.${SEARCH_LINK_MATCH_CLASS}`]: {
    backgroundColor: "var(--nexus-search-fuzzy-match-bg)",
    borderRadius: "var(--nexus-search-fuzzy-match-radius)",
    color: "inherit",
    textDecoration: "inherit"
  },
  [`.${SEARCH_LINK_ACTIVE_MATCH_CLASS}`]: {
    backgroundColor: "var(--nexus-search-fuzzy-active-match-bg)"
  },
  ".nexus-search-fuzzy-status": {
    display: "block",
    boxSizing: "border-box",
    margin: "0 10px 7px",
    maxWidth: "calc(100% - 20px)",
    padding: "5px 8px",
    border: "1px solid var(--nexus-search-border)",
    borderRadius: "4px",
    background: "var(--nexus-search-surface)",
    color: "var(--nexus-search-status-color)",
    fontSize: "var(--nexus-search-status-font-size)",
    lineHeight: "16px"
  },
  "@media (max-width: 760px)": {
    ".nexus-search-panel .cm-textfield": {
      minWidth: "84px"
    }
  },
  "@media (prefers-reduced-motion: reduce)": {
    [`.${FUZZY_MATCH_CLASS}`]: { transition: "none" },
    ".nexus-search-panel .cm-button, .nexus-search-panel .cm-textfield": {
      transition: "none"
    }
  }
});

function resolveMaxEntries(maxEntries: number | undefined): number {
  if (maxEntries === undefined || !Number.isFinite(maxEntries)) {
    return DEFAULT_SEARCH_HISTORY_MAX_ENTRIES;
  }
  return Math.max(0, Math.floor(maxEntries));
}

function normalizeHistoryEntries(value: unknown, maxEntries: number): string[] {
  if (!Array.isArray(value) || maxEntries <= 0) {
    return [];
  }

  const entries: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;

    const query = item.trim();
    if (!query || entries.includes(query)) continue;

    entries.push(query);
    if (entries.length >= maxEntries) break;
  }

  return entries;
}

class SearchHistoryController {
  private readonly enabled: boolean;
  private readonly storage?: SearchHistoryStorage;
  private readonly storageKey: string;
  private readonly maxEntries: number;
  private entries: string[] = [];
  private loaded = false;
  private cursor: number | null = null;
  private draft = "";

  constructor(options: boolean | SearchHistoryOptions | undefined) {
    this.enabled = options !== undefined && options !== false;
    const config = typeof options === "object" ? options : undefined;
    this.storage = config?.storage;
    this.storageKey = config?.storageKey?.trim() || DEFAULT_SEARCH_HISTORY_KEY;
    this.maxEntries = resolveMaxEntries(config?.maxEntries);
  }

  record(query: string): void {
    if (!this.enabled) return;

    const normalized = query.trim();
    if (!normalized) return;

    this.ensureLoaded();
    this.entries = [normalized, ...this.entries.filter((entry) => entry !== normalized)].slice(
      0,
      this.maxEntries
    );
    this.resetCursor();
    this.save();
  }

  recall(direction: SearchHistoryDirection, currentValue: string): string | null {
    if (!this.enabled) return null;

    this.ensureLoaded();
    if (this.entries.length === 0) return null;

    if (direction === "previous") {
      if (this.cursor === null) {
        this.draft = currentValue;
        this.cursor = 0;
      } else if (this.cursor < this.entries.length - 1) {
        this.cursor += 1;
      }

      return this.entries[this.cursor];
    }

    if (this.cursor === null) return null;

    if (this.cursor > 0) {
      this.cursor -= 1;
      return this.entries[this.cursor];
    }

    const draft = this.draft;
    this.resetCursor();
    return draft;
  }

  resetCursor(): void {
    this.cursor = null;
    this.draft = "";
  }

  private ensureLoaded(): void {
    if (this.loaded) return;

    this.loaded = true;
    if (!this.storage) return;

    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      this.entries = [];
      return;
    }

    if (!raw) {
      this.entries = [];
      return;
    }

    try {
      this.entries = normalizeHistoryEntries(JSON.parse(raw), this.maxEntries);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    if (!this.storage) return;

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {
      // Host storage is optional; search behavior should continue if it fails.
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchPattern(query: string, options: SearchOptions = {}): RegExp | null {
  const flags = options.caseSensitive ? "g" : "gi";

  let pattern: string;
  if (options.regexp) {
    pattern = options.wholeWord ? `\\b(?:${query})\\b` : query;
  } else {
    const escaped = escapeRegExp(query);
    pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function findSearchMatches(
  doc: string,
  query: string,
  options: SearchOptions = {}
): SearchMatch[] {
  if (!query) {
    return [];
  }

  const pattern = buildSearchPattern(query, options);
  if (!pattern) {
    return [];
  }
  const matches: SearchMatch[] = [];

  for (const match of doc.matchAll(pattern)) {
    const text = match[0];
    const from = match.index ?? 0;

    matches.push({
      from,
      to: from + text.length,
      text
    });
  }

  return matches;
}

export function findFuzzyMatches(
  doc: string,
  query: string,
  options: FuzzySearchOptions = {}
): FuzzySearchMatch[] {
  const maxResults = resolveFuzzyMaxResults(options.maxResults);
  if (!query || maxResults === 0) return [];

  const haystack = options.caseSensitive ? doc : doc.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  if (Array.from(needle).some((character) => !isFuzzyTokenCharacter(character))) {
    return [];
  }
  const matches: FuzzySearchMatch[] = [];
  let worstMatchIndex = -1;

  for (let tokenStart = 0; tokenStart < haystack.length; ) {
    if (!isFuzzyTokenCharacter(doc[tokenStart])) {
      tokenStart++;
      continue;
    }

    let tokenEnd = tokenStart + 1;
    while (tokenEnd < doc.length && isFuzzyTokenCharacter(doc[tokenEnd])) tokenEnd++;

    for (let from = tokenStart; from < tokenEnd; from++) {
      if (haystack[from] !== needle[0]) continue;

      const positions = [from];
      let cursor = from + 1;
      for (let index = 1; index < needle.length; index++) {
        cursor = haystack.indexOf(needle[index], cursor);
        if (cursor === -1 || cursor >= tokenEnd) break;
        positions.push(cursor);
        cursor++;
      }
      if (positions.length !== needle.length) continue;

      const to = positions[positions.length - 1] + 1;
      const gaps = to - from - needle.length;
      const match: FuzzySearchMatch = {
        from,
        to,
        text: doc.slice(from, to),
        positions,
        score: gaps * (doc.length + 1) + from
      };

      if (matches.length < maxResults) {
        matches.push(match);
        if (matches.length === maxResults) {
          worstMatchIndex = findWorstFuzzyMatchIndex(matches);
        }
      } else if (compareFuzzyMatches(match, matches[worstMatchIndex]) < 0) {
        matches[worstMatchIndex] = match;
        worstMatchIndex = findWorstFuzzyMatchIndex(matches);
      }
    }

    tokenStart = tokenEnd;
  }

  return matches.sort(compareFuzzyMatches);
}

function isFuzzyTokenCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

function resolveFuzzyMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) {
    return DEFAULT_FUZZY_MAX_RESULTS;
  }
  return Math.max(0, Math.floor(maxResults));
}

function compareFuzzyMatches(left: FuzzySearchMatch, right: FuzzySearchMatch): number {
  return left.score - right.score || left.from - right.from;
}

function findWorstFuzzyMatchIndex(matches: readonly FuzzySearchMatch[]): number {
  let worstIndex = 0;
  for (let index = 1; index < matches.length; index++) {
    if (compareFuzzyMatches(matches[index], matches[worstIndex]) > 0) {
      worstIndex = index;
    }
  }
  return worstIndex;
}

export function replaceAllMatches(
  doc: string,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): string {
  if (!query) {
    return doc;
  }

  const pattern = buildSearchPattern(query, options);
  if (!pattern) {
    return doc;
  }
  return doc.replace(pattern, replacement);
}

function resolveLabel(
  view: EditorView,
  labels: Partial<SearchPluginLabels> | undefined,
  key: keyof SearchPluginLabels,
  fallback: string
): string {
  const candidate = labels?.[key]?.trim();
  if (candidate) return candidate;

  const phrase = view.state.phrase(fallback).trim();
  return phrase || fallback;
}

function resolveLabels(
  view: EditorView,
  labels: Partial<SearchPluginLabels> | undefined
): ResolvedSearchPluginLabels {
  return {
    find: resolveLabel(view, labels, "find", DEFAULT_LABELS.find),
    replace: resolveLabel(view, labels, "replace", DEFAULT_LABELS.replace),
    next: resolveLabel(view, labels, "next", DEFAULT_LABELS.next),
    previous: resolveLabel(view, labels, "previous", DEFAULT_LABELS.previous),
    fuzzy: resolveLabel(view, labels, "fuzzy", DEFAULT_LABELS.fuzzy),
    replaceNext: resolveLabel(view, labels, "replaceNext", DEFAULT_LABELS.replaceNext),
    replaceAll: resolveLabel(view, labels, "replaceAll", DEFAULT_LABELS.replaceAll),
    close: resolveLabel(view, labels, "close", DEFAULT_LABELS.close),
    noFuzzyMatches: resolveLabel(view, labels, "noFuzzyMatches", DEFAULT_LABELS.noFuzzyMatches)
  };
}

function createButton(
  testId: string,
  name: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "cm-button";
  button.dataset.testId = testId;
  button.name = name;
  button.textContent = label;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

type SearchIconName = "previous" | "next" | "fuzzy" | "close";

let searchTooltipId = 0;

const SEARCH_TOOLTIP_STYLES = `
  position: fixed;
  z-index: 1100;
  transform: translateX(-50%);
  padding: 5px 7px;
  border-radius: 4px;
  background: var(--nexus-tooltip-bg, #333333);
  color: var(--nexus-tooltip-text, #ffffff);
  font: 11px/1 system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  pointer-events: none;
`;

function positionSearchTooltip(button: HTMLElement, tooltip: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  const win = button.ownerDocument.defaultView;
  const below = rect.bottom + 8;
  const top = win && below + tooltip.offsetHeight > win.innerHeight
    ? rect.top - tooltip.offsetHeight - 8
    : below;
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${top}px`;
}

function pickSearchTooltipMount(button: HTMLElement): HTMLElement {
  const doc = button.ownerDocument;
  const fullscreenElement = doc.fullscreenElement as HTMLElement | null;
  if (fullscreenElement?.contains(button)) return fullscreenElement;
  return doc.body;
}

function installSearchTooltip(button: HTMLButtonElement): () => void {
  const tooltip = button.ownerDocument.createElement("div");
  tooltip.className = "nexus-search-tooltip";
  tooltip.style.cssText = SEARCH_TOOLTIP_STYLES;
  tooltip.id = `nexus-search-tooltip-${++searchTooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  button.setAttribute("aria-describedby", tooltip.id);

  const show = () => {
    const label = button.getAttribute("aria-label") ?? "";
    if (!label.trim()) return;
    tooltip.textContent = label;
    if (!tooltip.isConnected) pickSearchTooltipMount(button).append(tooltip);
    positionSearchTooltip(button, tooltip);
  };
  const hide = () => tooltip.remove();
  const updatePosition = () => {
    if (tooltip.isConnected) positionSearchTooltip(button, tooltip);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  const win = button.ownerDocument.defaultView;

  button.addEventListener("mouseenter", show);
  button.addEventListener("focus", show);
  button.addEventListener("mouseleave", hide);
  button.addEventListener("blur", hide);
  button.addEventListener("click", hide);
  button.addEventListener("keydown", handleKeyDown);
  win?.addEventListener("scroll", updatePosition, true);
  win?.addEventListener("resize", updatePosition);

  return () => {
    button.removeEventListener("mouseenter", show);
    button.removeEventListener("focus", show);
    button.removeEventListener("mouseleave", hide);
    button.removeEventListener("blur", hide);
    button.removeEventListener("click", hide);
    button.removeEventListener("keydown", handleKeyDown);
    win?.removeEventListener("scroll", updatePosition, true);
    win?.removeEventListener("resize", updatePosition);
    hide();
  };
}

function createIcon(name: SearchIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const appendPath = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  };
  switch (name) {
    case "previous":
      appendPath("m18 15-6-6-6 6");
      break;
    case "next":
      appendPath("m6 9 6 6 6-6");
      break;
    case "fuzzy":
      appendPath("M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13");
      appendPath("M15 15l5 5");
      break;
    case "close":
      appendPath("M7 7l10 10M17 7 7 17");
      break;
  }

  return svg;
}

interface SearchButtonElements {
  wrapper: HTMLSpanElement;
  button: HTMLButtonElement;
  destroyTooltip?: () => void;
}

function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute("aria-label", label);
  button.removeAttribute("title");
}

function createIconButtonElements(
  testId: string,
  name: string,
  label: string,
  icon: SearchIconName,
  onClick: () => void
): SearchButtonElements {
  const wrapper = document.createElement("span");
  wrapper.className = "nexus-search-button-wrap";

  const button = createButton(testId, name, label, onClick);
  button.classList.add("nexus-search-icon-button");
  button.dataset.iconOnly = "true";
  button.textContent = "";
  button.appendChild(createIcon(icon));

  wrapper.append(button);
  setButtonLabel(button, label);
  return { wrapper, button, destroyTooltip: installSearchTooltip(button) };
}

function createIconButton(
  testId: string,
  name: string,
  label: string,
  icon: SearchIconName,
  onClick: () => void
): SearchButtonElements {
  return createIconButtonElements(testId, name, label, icon, onClick);
}

function createTextButtonElements(
  testId: string,
  name: string,
  label: string,
  onClick: () => void
): SearchButtonElements {
  const wrapper = document.createElement("span");
  wrapper.className = "nexus-search-button-wrap";

  const button = createButton(testId, name, label, onClick);
  button.classList.add("nexus-search-text-button");

  wrapper.append(button);
  return { wrapper, button };
}

function createSearchRow(testId: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "nexus-search-row";
  row.dataset.testId = testId;
  return row;
}

class NexusSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly pos = 80;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly fuzzyStatus: HTMLSpanElement;
  private readonly labels: ResolvedSearchPluginLabels;
  private readonly history: SearchHistoryController;
  private readonly fuzzyToggle: SearchButtonElements;
  private readonly replaceNextButton?: HTMLButtonElement;
  private readonly replaceAllButton?: HTMLButtonElement;
  private readonly destroyTooltips: Array<() => void> = [];
  private readonly searchAnchor: number;
  private fuzzyEnabled = false;
  private lastSearchInput: string;
  private lastFuzzyMode = false;

  constructor(
    private readonly view: EditorView,
    readonly top: boolean,
    labels: Partial<SearchPluginLabels> | undefined,
    history: SearchHistoryController
  ) {
    this.query = getSearchQuery(view.state);
    this.searchAnchor = view.state.selection.main.from;
    const resolvedLabels = resolveLabels(view, labels);
    this.labels = resolvedLabels;
    this.history = history;

    this.searchField = this.createTextField(
      "markdown-search-input",
      "search",
      resolvedLabels.find,
      this.query.search,
      true
    );
    this.lastSearchInput = this.searchField.value;
    this.replaceField = this.createTextField(
      "markdown-search-replace-input",
      "replace",
      resolvedLabels.replace,
      this.query.replace,
      false
    );
    this.fuzzyStatus = document.createElement("span");
    this.fuzzyStatus.className = "nexus-search-fuzzy-status";
    this.fuzzyStatus.dataset.testId = "markdown-search-fuzzy-status";
    this.fuzzyStatus.setAttribute("aria-live", "polite");
    this.fuzzyStatus.hidden = true;

    this.dom = document.createElement("div");
    this.dom.className = "nexus-search-panel";
    this.dom.dataset.testId = "markdown-search-bar";
    this.dom.addEventListener("keydown", (event) => this.handleKeyDown(event));

    const searchRow = createSearchRow("markdown-search-find-row");
    const canReplace = !view.state.readOnly;
    const navigationGroup = document.createElement("div");
    navigationGroup.className = "nexus-search-button-group";
    const previousButton = createIconButton(
      "markdown-search-prev",
      "prev",
      resolvedLabels.previous,
      "previous",
      () => this.submitSearch(() => this.navigate("previous"))
    );
    const nextButton = createIconButton(
      "markdown-search-next",
      "next",
      resolvedLabels.next,
      "next",
      () => this.submitSearch(() => this.navigate("next"))
    );
    navigationGroup.append(previousButton.wrapper, nextButton.wrapper);
    if (previousButton.destroyTooltip) this.destroyTooltips.push(previousButton.destroyTooltip);
    if (nextButton.destroyTooltip) this.destroyTooltips.push(nextButton.destroyTooltip);

    this.fuzzyToggle = createIconButtonElements(
      "markdown-search-fuzzy-toggle",
      "fuzzy",
      resolvedLabels.fuzzy,
      "fuzzy",
      () => {
        this.fuzzyEnabled = !this.fuzzyEnabled;
        this.commit();
      }
    );
    this.fuzzyToggle.button.setAttribute("aria-pressed", "false");
    if (this.fuzzyToggle.destroyTooltip) this.destroyTooltips.push(this.fuzzyToggle.destroyTooltip);

    searchRow.append(this.searchField, navigationGroup, this.fuzzyToggle.wrapper);

    if (canReplace) {
      const divider = document.createElement("span");
      divider.className = "nexus-search-divider";
      divider.setAttribute("aria-hidden", "true");
      const replaceNextElements = createTextButtonElements(
        "markdown-search-replace",
        "replace",
        resolvedLabels.replaceNext,
        () => replaceNext(view)
      );
      const replaceAllElements = createTextButtonElements(
        "markdown-search-replace-all",
        "replaceAll",
        resolvedLabels.replaceAll,
        () => replaceAll(view)
      );
      this.replaceNextButton = replaceNextElements.button;
      this.replaceAllButton = replaceAllElements.button;
      searchRow.append(
        divider,
        this.replaceField,
        replaceNextElements.wrapper,
        replaceAllElements.wrapper
      );
    }

    const closeButton = createIconButtonElements(
      "markdown-search-close",
      "close",
      resolvedLabels.close,
      "close",
      () => closeSearchPanel(view)
    );
    if (closeButton.destroyTooltip) this.destroyTooltips.push(closeButton.destroyTooltip);
    searchRow.append(closeButton.wrapper);
    this.dom.append(searchRow, this.fuzzyStatus);
    this.syncFuzzyControls();
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
    if (update.docChanged && this.fuzzyEnabled) {
      this.updateFuzzyStatus();
    }
  }

  mount(): void {
    this.searchField.select();
  }

  destroy(): void {
    for (const destroyTooltip of this.destroyTooltips) destroyTooltip();
  }

  private createTextField(
    testId: string,
    name: string,
    placeholder: string,
    value: string,
    mainField: boolean
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "cm-textfield";
    input.dataset.testId = testId;
    input.name = name;
    input.setAttribute("form", "");
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    input.value = value;
    if (mainField) {
      input.setAttribute("main-field", "true");
    }
    input.addEventListener("input", () => {
      if (mainField) this.history.resetCursor();
      this.commit();
    });
    input.addEventListener("change", () => {
      if (mainField) this.history.resetCursor();
      this.commit();
    });
    input.addEventListener("keyup", () => this.commit());
    return input;
  }

  private commit(): void {
    this.syncFuzzyControls();
    const fuzzy = this.fuzzyEnabled;
    const search = this.searchField.value;
    if (search !== this.lastSearchInput || fuzzy !== this.lastFuzzyMode) {
      this.clearEditorSelection();
      this.lastSearchInput = search;
      this.lastFuzzyMode = fuzzy;
    }

    const query = new SearchQuery({
      search: fuzzy ? "" : search,
      caseSensitive: this.query.caseSensitive,
      regexp: fuzzy ? false : this.query.regexp,
      wholeWord: fuzzy ? false : this.query.wholeWord,
      replace: this.replaceField.value
    });
    const highlighter = this.fuzzySearch();
    highlighter?.configure({
      enabled: fuzzy,
      query: search,
      caseSensitive: this.query.caseSensitive
    });
    highlighter?.configureLiteral(fuzzy ? null : query);

    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    } else {
      this.view.dispatch({});
    }
    this.updateFuzzyStatus();
  }

  private submitSearch(runSearchCommand: () => void): void {
    this.commit();
    this.history.record(this.searchField.value);
    runSearchCommand();
  }

  private navigate(direction: "next" | "previous"): void {
    if (this.fuzzyEnabled) {
      this.fuzzySearch()?.navigate(direction);
      return;
    }
    this.fuzzySearch()?.navigateLiteral(direction);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.handleHistoryKeyDown(event)) {
      return;
    }

    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      this.submitSearch(() => this.navigate(event.shiftKey ? "previous" : "next"));
      return;
    }

    if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      this.commit();
      replaceNext(this.view);
    }
  }

  private handleHistoryKeyDown(event: KeyboardEvent): boolean {
    if (event.target !== this.searchField || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return false;
    }

    const recalled = this.history.recall(
      event.key === "ArrowUp" ? "previous" : "next",
      this.searchField.value
    );
    if (recalled === null) return false;

    event.preventDefault();
    this.searchField.value = recalled;
    this.commit();
    return true;
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    if (!this.fuzzyEnabled) {
      this.searchField.value = query.search;
    }
    this.lastSearchInput = this.searchField.value;
    this.replaceField.value = query.replace;
    this.syncFuzzyControls();
    this.updateFuzzyStatus();
  }

  private fuzzySearch(): FuzzySearchHighlighter | null {
    return this.view.plugin(fuzzySearchHighlighter) ?? null;
  }

  private clearEditorSelection(): void {
    const selection = this.view.state.selection.main;
    if (!selection.empty || selection.from !== this.searchAnchor) {
      this.view.dispatch({ selection: { anchor: this.searchAnchor } });
    }
  }

  private syncFuzzyControls(): void {
    const fuzzy = this.fuzzyEnabled;
    this.replaceField.disabled = fuzzy;
    this.replaceNextButton?.toggleAttribute("disabled", fuzzy);
    this.replaceAllButton?.toggleAttribute("disabled", fuzzy);
    this.fuzzyToggle.button.dataset.active = String(fuzzy);
    this.fuzzyToggle.button.setAttribute("aria-pressed", String(fuzzy));
  }

  private updateFuzzyStatus(): void {
    if (!this.fuzzyEnabled || !this.searchField.value) {
      this.fuzzyStatus.hidden = true;
      this.fuzzyStatus.textContent = "";
      return;
    }

    const empty = this.fuzzySearch()?.resultCount === 0;
    this.fuzzyStatus.hidden = !empty;
    this.fuzzyStatus.textContent = empty ? this.labels.noFuzzyMatches : "";
  }
}

export function createSearchPlugin(options: SearchPluginOptions = {}): NexusPlugin {
  const history = new SearchHistoryController(options.history);
  const cmExtensions = [
    search({
      top: options.top ?? true,
      caseSensitive: options.caseSensitive ?? false,
      literal: true,
      createPanel: (view) => new NexusSearchPanel(view, options.top ?? true, options.labels, history)
    }),
    keymap.of(searchKeymap),
    tableSearchHighlightPlugin,
    fuzzySearchHighlighter,
    fuzzySearchTheme
  ];

  if (options.highlightSelectionMatches ?? true) {
    cmExtensions.push(highlightSelectionMatches());
  }

  return {
    name: "plugin-search",
    cmExtensions
  };
}
