import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  selectMatches,
  setSearchQuery
} from "@codemirror/search";
import {
  keymap,
  runScopeHandlers,
  ViewPlugin,
  type EditorView,
  type Panel,
  type ViewUpdate
} from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface SearchMatch {
  from: number;
  to: number;
  text: string;
  /**
   * Relevance score, present only for fuzzy matches.
   */
  score?: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  /**
   * Match the query as an ordered subsequence within a line.
   */
  fuzzy?: boolean;
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
  showReplace: string;
  hideReplace: string;
  next: string;
  previous: string;
  all: string;
  matchCase: string;
  regexp: string;
  byWord: string;
  fuzzy?: string;
  replaceNext: string;
  replaceAll: string;
  close: string;
}

const DEFAULT_LABELS: SearchPluginLabels & { fuzzy: string } = {
  find: "Find",
  replace: "Replace",
  showReplace: "Show replace",
  hideReplace: "Hide replace",
  next: "Next",
  previous: "Previous",
  all: "All",
  matchCase: "Match case",
  regexp: "Regexp",
  byWord: "By word",
  fuzzy: "Fuzzy",
  replaceNext: "Replace",
  replaceAll: "Replace all",
  close: "Close"
};

const DEFAULT_SEARCH_HISTORY_KEY = "nexus.search.history";
const DEFAULT_SEARCH_HISTORY_MAX_ENTRIES = 20;
const TABLE_SEARCH_CELL_SELECTOR = ".nexus-table-wrapper .nexus-cell";
const TABLE_SEARCH_HIGHLIGHT_PREFIX = "nexus-table-search";

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

const FUZZY_SCORE_MATCH = 10;
const FUZZY_BONUS_BOUNDARY = 8;
const FUZZY_BONUS_CONSECUTIVE = 5;
const FUZZY_BONUS_CASE_MATCH = 1;
const FUZZY_PENALTY_GAP_START = 2;
const FUZZY_PENALTY_GAP_EXTEND = 1;
const FUZZY_SEPARATORS = " \t/\\|-_:.,\"'({[<>";

type SearchEditorState = EditorView["state"];

type FuzzyCursorState = Parameters<SearchQuery["getCursor"]>[0];

interface FuzzyTextDocument {
  length: number;
  sliceString(from: number, to?: number): string;
  lineAt(pos: number): { from: number; to: number; text: string };
}

interface FuzzyLineMatch {
  from: number;
  to: number;
  score: number;
}

function isFuzzySeparator(value: string): boolean {
  return FUZZY_SEPARATORS.includes(value);
}

function isFuzzyLowerAlpha(value: string): boolean {
  return value >= "a" && value <= "z";
}

function isFuzzyUpperAlpha(value: string): boolean {
  return value >= "A" && value <= "Z";
}

function isFuzzyBoundary(line: string, pos: number): boolean {
  if (pos === 0) return true;
  const previous = line[pos - 1];
  if (isFuzzySeparator(previous)) return true;
  return isFuzzyLowerAlpha(previous) && isFuzzyUpperAlpha(line[pos]);
}

function fuzzyCharsEqual(
  caseSensitive: boolean
): (lineChar: string, queryChar: string) => boolean {
  if (caseSensitive) {
    return (lineChar, queryChar) => lineChar === queryChar;
  }
  return (lineChar, queryChar) => lineChar.toLowerCase() === queryChar.toLowerCase();
}

function scoreFuzzyMatch(
  line: string,
  query: string,
  positions: number[],
  caseSensitive: boolean
): number {
  let score = 0;

  for (let index = 0; index < positions.length; index++) {
    const pos = positions[index];
    score += FUZZY_SCORE_MATCH;

    if (!caseSensitive && line[pos] === query[index]) {
      score += FUZZY_BONUS_CASE_MATCH;
    }

    if (isFuzzyBoundary(line, pos)) {
      score += index === 0 ? FUZZY_BONUS_BOUNDARY * 2 : FUZZY_BONUS_BOUNDARY;
    }

    if (index > 0) {
      if (pos === positions[index - 1] + 1) {
        score += FUZZY_BONUS_CONSECUTIVE;
      }
      const gap = pos - positions[index - 1] - 1;
      if (gap > 0) {
        score -= FUZZY_PENALTY_GAP_START + (gap - 1) * FUZZY_PENALTY_GAP_EXTEND;
      }
    }
  }

  return score;
}

function matchFuzzyLine(
  line: string,
  query: string,
  caseSensitive: boolean,
  start: number
): FuzzyLineMatch | null {
  const queryLength = query.length;
  if (queryLength === 0 || line.length < queryLength || start >= line.length) {
    return null;
  }

  const charsEqual = fuzzyCharsEqual(caseSensitive);
  const positions = new Array<number>(queryLength);

  let queryIndex = 0;
  for (let pos = start; pos < line.length && queryIndex < queryLength; pos++) {
    if (charsEqual(line[pos], query[queryIndex])) {
      positions[queryIndex++] = pos;
    }
  }
  if (queryIndex < queryLength) {
    return null;
  }

  let cursor = positions[queryLength - 1];
  for (let index = queryLength - 1; index >= 0; index--) {
    let found = -1;
    for (let pos = cursor; pos >= start; pos--) {
      if (charsEqual(line[pos], query[index])) {
        found = pos;
        break;
      }
    }
    if (found < 0) {
      return null;
    }
    positions[index] = found;
    cursor = found - 1;
  }

  return {
    from: positions[0],
    to: positions[queryLength - 1] + 1,
    score: scoreFuzzyMatch(line, query, positions, caseSensitive)
  };
}

function matchAllFuzzyInLine(
  line: string,
  query: string,
  caseSensitive: boolean
): FuzzyLineMatch[] {
  const matches: FuzzyLineMatch[] = [];

  for (let start = 0; start < line.length; ) {
    const match = matchFuzzyLine(line, query, caseSensitive, start);
    if (!match) break;
    matches.push(match);
    start = match.to;
  }

  return matches;
}

function forEachDocumentLine(doc: string, visit: (line: string, start: number) => void): void {
  let start = 0;

  for (let index = 0; index < doc.length; index++) {
    const char = doc[index];
    if (char !== "\r" && char !== "\n") continue;
    visit(doc.slice(start, index), start);
    if (char === "\r" && doc[index + 1] === "\n") index++;
    start = index + 1;
  }

  visit(doc.slice(start), start);
}

function findFuzzyMatches(doc: string, query: string, caseSensitive: boolean): SearchMatch[] {
  const matches: SearchMatch[] = [];

  forEachDocumentLine(doc, (line, lineStart) => {
    for (const match of matchAllFuzzyInLine(line, query, caseSensitive)) {
      matches.push({
        from: lineStart + match.from,
        to: lineStart + match.to,
        text: line.slice(match.from, match.to),
        score: match.score
      });
    }
  });

  return matches;
}

function fuzzyDocumentOf(state: FuzzyCursorState): FuzzyTextDocument {
  if ("doc" in state) {
    return (state as { doc: FuzzyTextDocument }).doc;
  }
  return state as unknown as FuzzyTextDocument;
}

function isFuzzySearchQuery(query: SearchQuery): query is FuzzySearchQuery {
  return (query as Partial<FuzzySearchQuery>).fuzzy === true;
}

function fuzzyMatchesInDocument(
  doc: FuzzyTextDocument,
  query: string,
  caseSensitive: boolean,
  from: number,
  to: number
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (doc.length === 0 || query.length === 0) return matches;

  const rangeStart = Math.max(0, Math.min(from, doc.length));
  const rangeEnd = Math.max(rangeStart, Math.min(to, doc.length));

  let line = doc.lineAt(Math.min(rangeStart, doc.length - 1));
  while (line.from <= rangeEnd) {
    if (line.to > rangeStart) {
      for (const match of matchAllFuzzyInLine(line.text, query, caseSensitive)) {
        const matchFrom = line.from + match.from;
        const matchTo = line.from + match.to;
        if (matchFrom < rangeStart || matchTo > rangeEnd) continue;
        matches.push({
          from: matchFrom,
          to: matchTo,
          text: doc.sliceString(matchFrom, matchTo),
          score: match.score
        });
      }
    }
    if (line.to >= doc.length) break;
    line = doc.lineAt(line.to + 1);
  }

  return matches;
}

/**
 * A search query that matches an ordered subsequence within a line instead of
 * a literal or regular expression.
 */
export class FuzzySearchQuery extends SearchQuery {
  readonly fuzzy = true;

  constructor(config: ConstructorParameters<typeof SearchQuery>[0]) {
    super({ ...config, literal: true, regexp: false, wholeWord: false });
  }

  override eq(other: SearchQuery): boolean {
    return super.eq(other) && (other as Partial<FuzzySearchQuery>).fuzzy === this.fuzzy;
  }

  getCursor(
    state: FuzzyCursorState,
    from = 0,
    to?: number
  ): Iterator<{ from: number; to: number }> {
    const doc = fuzzyDocumentOf(state);
    const rangeEnd = to ?? doc.length;
    const search = this.search;
    const caseSensitive = this.caseSensitive;

    function* matches(): Generator<{ from: number; to: number }> {
      for (const match of fuzzyMatchesInDocument(doc, search, caseSensitive, from, rangeEnd)) {
        yield { from: match.from, to: match.to };
      }
    }

    return matches();
  }

  create(): FuzzyQueryHandler {
    return new FuzzyQueryHandler(this);
  }
}

class FuzzyQueryHandler {
  readonly spec: FuzzySearchQuery;

  constructor(spec: FuzzySearchQuery) {
    this.spec = spec;
  }

  nextMatch(
    state: SearchEditorState,
    curFrom: number,
    curTo: number
  ): { from: number; to: number } | null {
    const doc = fuzzyDocumentOf(state);
    const forward = this.matches(doc, curTo, doc.length);
    if (forward.length > 0) {
      return { from: forward[0].from, to: forward[0].to };
    }

    const wrapped = this.matches(doc, 0, curFrom);
    const first = wrapped[0];
    return first && (first.from !== curFrom || first.to !== curTo)
      ? { from: first.from, to: first.to }
      : null;
  }

  prevMatch(
    state: SearchEditorState,
    curFrom: number,
    curTo: number
  ): { from: number; to: number } | null {
    const doc = fuzzyDocumentOf(state);
    const before = this.matches(doc, 0, curFrom);
    const previous = before[before.length - 1];
    if (previous) {
      return { from: previous.from, to: previous.to };
    }

    const all = this.matches(doc, 0, doc.length);
    const last = all[all.length - 1];
    return last && (last.from !== curFrom || last.to !== curTo)
      ? { from: last.from, to: last.to }
      : null;
  }

  matchAll(state: SearchEditorState, limit: number): SearchMatch[] | null {
    const doc = fuzzyDocumentOf(state);
    const matches = this.matches(doc, 0, doc.length);
    return matches.length > limit ? null : matches;
  }

  highlight(
    state: SearchEditorState,
    from: number,
    to: number,
    add: (from: number, to: number) => void
  ): void {
    const doc = fuzzyDocumentOf(state);
    for (const match of this.matches(doc, from, to)) {
      add(match.from, match.to);
    }
  }

  getReplacement(result: SearchMatch): string {
    return result.text;
  }

  private matches(doc: FuzzyTextDocument, from: number, to: number): SearchMatch[] {
    return fuzzyMatchesInDocument(doc, this.spec.search, this.spec.caseSensitive, from, to);
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

  if (options.fuzzy) {
    return findFuzzyMatches(doc, query, options.caseSensitive ?? false);
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
): SearchPluginLabels & { fuzzy: string } {
  return {
    find: resolveLabel(view, labels, "find", DEFAULT_LABELS.find),
    replace: resolveLabel(view, labels, "replace", DEFAULT_LABELS.replace),
    showReplace: resolveLabel(view, labels, "showReplace", DEFAULT_LABELS.showReplace),
    hideReplace: resolveLabel(view, labels, "hideReplace", DEFAULT_LABELS.hideReplace),
    next: resolveLabel(view, labels, "next", DEFAULT_LABELS.next),
    previous: resolveLabel(view, labels, "previous", DEFAULT_LABELS.previous),
    all: resolveLabel(view, labels, "all", DEFAULT_LABELS.all),
    matchCase: resolveLabel(view, labels, "matchCase", DEFAULT_LABELS.matchCase),
    regexp: resolveLabel(view, labels, "regexp", DEFAULT_LABELS.regexp),
    byWord: resolveLabel(view, labels, "byWord", DEFAULT_LABELS.byWord),
    fuzzy: resolveLabel(view, labels, "fuzzy", DEFAULT_LABELS.fuzzy),
    replaceNext: resolveLabel(view, labels, "replaceNext", DEFAULT_LABELS.replaceNext),
    replaceAll: resolveLabel(view, labels, "replaceAll", DEFAULT_LABELS.replaceAll),
    close: resolveLabel(view, labels, "close", DEFAULT_LABELS.close)
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

type SearchIconName = "toggleReplace" | "previous" | "next" | "all" | "replace" | "replaceAll";

function createIcon(name: SearchIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const appendPath = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  };
  const appendLine = (x1: number, y1: number, x2: number, y2: number) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    svg.appendChild(line);
  };
  const appendText = (text: string, x: number, y: number, size: number) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
    node.setAttribute("x", String(x));
    node.setAttribute("y", String(y));
    node.setAttribute("font-size", String(size));
    node.setAttribute("font-family", "system-ui, sans-serif");
    node.setAttribute("font-weight", "700");
    node.setAttribute("fill", "currentColor");
    node.setAttribute("stroke", "none");
    node.textContent = text;
    svg.appendChild(node);
  };

  switch (name) {
    case "toggleReplace":
      appendPath("m9 18 6-6-6-6");
      break;
    case "previous":
      appendPath("m15 18-6-6 6-6");
      break;
    case "next":
      appendPath("m9 18 6-6-6-6");
      break;
    case "all":
      appendLine(5, 7, 19, 7);
      appendLine(5, 12, 19, 12);
      appendLine(5, 17, 19, 17);
      break;
    case "replace":
      appendText("R", 4, 17, 13);
      appendPath("m15 8 3 3-3 3");
      break;
    case "replaceAll":
      appendText("R", 3, 17, 12);
      appendPath("m14 7 3 3-3 3");
      appendPath("m17 7 3 3-3 3");
      break;
  }

  return svg;
}

let tooltipId = 0;
let rowId = 0;

function createTooltip(testId: string, label: string): HTMLSpanElement {
  const tooltip = document.createElement("span");
  tooltip.className = "nexus-search-tooltip";
  tooltip.dataset.testId = `${testId}-tooltip`;
  tooltip.dataset.tooltip = label;
  tooltip.id = `${testId}-tooltip-${++tooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-label", label);
  tooltip.textContent = label;
  return tooltip;
}

interface IconButtonElements {
  wrapper: HTMLSpanElement;
  button: HTMLButtonElement;
  tooltip: HTMLSpanElement;
}

function setIconButtonLabel(elements: IconButtonElements, label: string): void {
  elements.button.setAttribute("aria-label", label);
  elements.button.dataset.tooltipLabel = label;
  elements.tooltip.dataset.tooltip = label;
  elements.tooltip.setAttribute("aria-label", label);
  elements.tooltip.textContent = label;
}

function createIconButtonElements(
  testId: string,
  name: string,
  label: string,
  icon: SearchIconName,
  onClick: () => void
): IconButtonElements {
  const wrapper = document.createElement("span");
  wrapper.className = "nexus-search-tooltip-wrap";

  const button = createButton(testId, name, label, onClick);
  button.classList.add("nexus-search-icon-button");
  button.dataset.iconOnly = "true";
  button.removeAttribute("title");
  button.textContent = "";
  button.appendChild(createIcon(icon));

  const tooltip = createTooltip(testId, label);
  button.setAttribute("aria-describedby", tooltip.id);
  wrapper.append(button, tooltip);
  setIconButtonLabel({ wrapper, button, tooltip }, label);
  return { wrapper, button, tooltip };
}

function createIconButton(
  testId: string,
  name: string,
  label: string,
  icon: SearchIconName,
  onClick: () => void
): HTMLSpanElement {
  const { wrapper } = createIconButtonElements(testId, name, label, icon, onClick);
  return wrapper;
}

function createLabel(input: HTMLInputElement, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(input, text);
  return label;
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
  private readonly caseField: HTMLInputElement;
  private readonly regexpField: HTMLInputElement;
  private readonly wholeWordField: HTMLInputElement;
  private readonly fuzzyField: HTMLInputElement;
  private readonly labels: SearchPluginLabels & { fuzzy: string };
  private readonly history: SearchHistoryController;
  private readonly replaceRow?: HTMLDivElement;
  private readonly replaceToggle?: IconButtonElements;
  private replaceExpanded = false;

  constructor(
    private readonly view: EditorView,
    readonly top: boolean,
    labels: Partial<SearchPluginLabels> | undefined,
    history: SearchHistoryController
  ) {
    this.query = getSearchQuery(view.state);
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
    this.replaceField = this.createTextField(
      "markdown-search-replace-input",
      "replace",
      resolvedLabels.replace,
      this.query.replace,
      false
    );
    this.caseField = this.createCheckbox("markdown-search-case-toggle", "case", this.query.caseSensitive);
    this.regexpField = this.createCheckbox("markdown-search-regexp-toggle", "re", this.query.regexp, (input) => {
      if (input.checked) this.fuzzyField.checked = false;
    });
    this.wholeWordField = this.createCheckbox("markdown-search-word-toggle", "word", this.query.wholeWord, (input) => {
      if (input.checked) this.fuzzyField.checked = false;
    });
    this.fuzzyField = this.createCheckbox("markdown-search-fuzzy-toggle", "fuzzy", isFuzzySearchQuery(this.query), () => {
      this.regexpField.checked = false;
      this.wholeWordField.checked = false;
    });

    this.dom = document.createElement("div");
    this.dom.className = "cm-search nexus-search-panel";
    this.dom.dataset.testId = "markdown-search-bar";
    this.dom.addEventListener("keydown", (event) => this.handleKeyDown(event));

    const searchRow = createSearchRow("markdown-search-find-row");
    const canReplace = !view.state.readOnly;
    if (canReplace) {
      this.replaceToggle = createIconButtonElements(
        "markdown-search-toggle-replace",
        "toggleReplace",
        resolvedLabels.showReplace,
        "toggleReplace",
        () => this.setReplaceExpanded(!this.replaceExpanded, true)
      );
    }
    const navigationGroup = document.createElement("div");
    navigationGroup.className = "nexus-search-button-group";
    navigationGroup.append(
      createIconButton("markdown-search-prev", "prev", resolvedLabels.previous, "previous", () =>
        this.submitSearch(() => findPrevious(view))
      ),
      createIconButton("markdown-search-next", "next", resolvedLabels.next, "next", () =>
        this.submitSearch(() => findNext(view))
      ),
      createIconButton("markdown-search-all", "select", resolvedLabels.all, "all", () =>
        this.submitSearch(() => selectMatches(view))
      )
    );

    const searchRowChildren: HTMLElement[] = [
      this.searchField,
      createLabel(this.caseField, resolvedLabels.matchCase),
      createLabel(this.regexpField, resolvedLabels.regexp),
      createLabel(this.wholeWordField, resolvedLabels.byWord),
      createLabel(this.fuzzyField, resolvedLabels.fuzzy),
      navigationGroup
    ];
    if (this.replaceToggle) {
      searchRowChildren.unshift(this.replaceToggle.wrapper);
    }
    searchRow.append(...searchRowChildren);

    this.dom.append(searchRow);

    if (canReplace) {
      const replaceRow = createSearchRow("markdown-search-replace-row");
      replaceRow.id = `markdown-search-replace-row-${++rowId}`;
      this.replaceRow = replaceRow;
      this.replaceToggle?.button.setAttribute("aria-controls", replaceRow.id);
      this.replaceToggle?.button.setAttribute("aria-expanded", "false");
      replaceRow.append(
        this.replaceField,
        createIconButton("markdown-search-replace", "replace", resolvedLabels.replaceNext, "replace", () =>
          replaceNext(view)
        ),
        createIconButton(
          "markdown-search-replace-all",
          "replaceAll",
          resolvedLabels.replaceAll,
          "replaceAll",
          () => replaceAll(view)
        )
      );
      this.setReplaceExpanded(false);
      this.dom.append(replaceRow);
    }

    this.setFuzzyActive(this.fuzzyField.checked);

    const closeButton = createButton("markdown-search-close", "close", "×", () => closeSearchPanel(view));
    closeButton.setAttribute("aria-label", resolvedLabels.close);
    closeButton.title = resolvedLabels.close;
    this.dom.append(closeButton);
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }
  }

  mount(): void {
    this.searchField.select();
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

  private createCheckbox(
    testId: string,
    name: string,
    checked: boolean,
    onToggle?: (input: HTMLInputElement) => void
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.dataset.testId = testId;
    input.type = "checkbox";
    input.name = name;
    input.setAttribute("form", "");
    input.checked = checked;
    input.addEventListener("change", () => {
      onToggle?.(input);
      this.commit();
    });
    return input;
  }

  private commit(): void {
    const fuzzy = this.fuzzyField.checked;
    const query = fuzzy
      ? new FuzzySearchQuery({
          search: this.searchField.value,
          caseSensitive: this.caseField.checked,
          replace: this.replaceField.value
        })
      : new SearchQuery({
          search: this.searchField.value,
          caseSensitive: this.caseField.checked,
          regexp: this.regexpField.checked,
          wholeWord: this.wholeWordField.checked,
          replace: this.replaceField.value
        });

    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }

    this.setFuzzyActive(fuzzy);
  }

  private submitSearch(runSearchCommand: () => void): void {
    this.commit();
    this.history.record(this.searchField.value);
    runSearchCommand();
  }

  private setReplaceExpanded(expanded: boolean, focusReplace = false): void {
    if (!this.replaceRow || !this.replaceToggle) return;

    this.replaceExpanded = expanded;
    this.replaceRow.hidden = !expanded;
    this.replaceRow.setAttribute("aria-hidden", String(!expanded));
    this.replaceToggle.button.setAttribute("aria-expanded", String(expanded));
    setIconButtonLabel(this.replaceToggle, expanded ? this.labels.hideReplace : this.labels.showReplace);

    if (expanded && focusReplace) {
      this.replaceField.focus();
      this.replaceField.select();
    }
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
      this.submitSearch(() => (event.shiftKey ? findPrevious : findNext)(this.view));
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

  private setFuzzyActive(fuzzy: boolean): void {
    if (this.replaceToggle) {
      this.replaceToggle.wrapper.hidden = fuzzy;
    }
    if (fuzzy && this.replaceExpanded) {
      this.setReplaceExpanded(false);
    }
  }

  private setQuery(query: SearchQuery): void {
    const fuzzy = isFuzzySearchQuery(query);
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.regexpField.checked = query.regexp;
    this.wholeWordField.checked = query.wholeWord;
    this.fuzzyField.checked = fuzzy;
    this.setFuzzyActive(fuzzy);
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
    tableSearchHighlightPlugin
  ];

  if (options.highlightSelectionMatches ?? true) {
    cmExtensions.push(highlightSelectionMatches());
  }

  return {
    name: "plugin-search",
    cmExtensions
  };
}
