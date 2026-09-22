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
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  /**
   * Enable fuzzy (approximate) matching. When true the query characters are
   * matched in order but need not be contiguous, similar to VS Code's
   * Ctrl+P file finder.
   *
   * Results are sorted by a continuity score: longer unbroken runs of
   * consecutive matching characters receive a higher score. Fuzzy mode
   * is incompatible with `regexp` and `wholeWord` — those options are
   * ignored when `fuzzy` is enabled.
   *
   * @example
   * fuzzyMatch("replacement", "repl") // matched: true, score: high
   * fuzzyMatch("workflow",    "wkfl") // matched: true, score: lower
   * fuzzyMatch("hello",       "xyz")  // matched: false
   */
  fuzzy?: boolean;
}

// ---------------------------------------------------------------------------
// Fuzzy match — lightweight inline implementation, zero external dependencies.
// ---------------------------------------------------------------------------

/**
 * A single match range returned by `fuzzyMatch`.
 * `from` is inclusive, `to` is exclusive (same as CM6 convention).
 */
export interface FuzzyMatchRange {
  from: number;
  to: number;
}

/**
 * Result of a fuzzy match attempt.
 */
export interface FuzzyMatchResult {
  /** Whether all query characters were found in order inside `text`. */
  matched: boolean;
  /**
   * Continuity score. Higher is better. Each consecutive run of matching
   * characters contributes `runLength * 2` to the score, so longer
   * unbroken runs dominate over scattered single-character matches.
   * Returns 0 when `matched` is false.
   */
  score: number;
  /**
   * Contiguous matched ranges inside `text`, in document order.
   * Empty when `matched` is false.
   */
  ranges: FuzzyMatchRange[];
}

/**
 * Perform a fuzzy (approximate) match of `query` inside `text`.
 *
 * Characters of `query` must appear in `text` in the same order, but do not
 * need to be adjacent. Results are scored by the length of the longest
 * contiguous run of matched characters so that callers can sort candidates
 * from best to worst match.
 *
 * @example
 * fuzzyMatch("workflow", "wkfl")
 * // => { matched: true, score: 4, ranges: [{from:0,to:1},{from:4,to:5},{from:7,to:8},...] }
 *
 * fuzzyMatch("replacement", "repl")
 * // => { matched: true, score: 16, ranges: [{from:0,to:4}] }
 *
 * fuzzyMatch("hello", "xyz")
 * // => { matched: false, score: 0, ranges: [] }
 */
export function fuzzyMatch(text: string, query: string, caseSensitive = false): FuzzyMatchResult {
  const noMatch: FuzzyMatchResult = { matched: false, score: 0, ranges: [] };
  if (!query) return { matched: true, score: 0, ranges: [] };

  const t = caseSensitive ? text : text.toLowerCase();
  const q = caseSensitive ? query : query.toLowerCase();

  if (q.length > t.length) return noMatch;

  const ranges: FuzzyMatchRange[] = [];
  let score = 0;
  let ti = 0;
  let qi = 0;
  let runStart = -1;
  let runLength = 0;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (runStart < 0) {
        // Start of a new contiguous run
        runStart = ti;
        runLength = 0;
      }
      runLength++;
      score += runLength * 2; // longer runs score exponentially better
      qi++;
    } else {
      if (runStart >= 0) {
        // Gap — close the current run and record the range
        ranges.push({ from: runStart, to: ti });
        runStart = -1;
        runLength = 0;
      }
    }
    ti++;
  }

  // Close the last open run (if the match ended without a gap)
  if (runStart >= 0) {
    ranges.push({ from: runStart, to: ti });
  }

  const matched = qi === q.length;
  if (!matched) return noMatch;

  // Boost exact whole-word matches and prefix matches, and penalize extra length
  if (t === q) {
    score += 100;
  } else if (t.startsWith(q)) {
    score += 40;
  }
  // Slight penalty for length difference to favor tighter matches
  score -= (t.length - q.length);

  return { matched, score, ranges };
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
  replaceNext: string;
  replaceAll: string;
  close: string;
}

const DEFAULT_LABELS: SearchPluginLabels = {
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

  // --- Fuzzy path -----------------------------------------------------------
  // Fuzzy mode is incompatible with regexp/wholeWord. It scans every
  // word-boundary-delimited token in the document and returns those that
  // fuzzy-match the query, sorted from best (highest score) to worst.
  if (options.fuzzy) {
    const caseSensitive = options.caseSensitive ?? false;
    // Split the document into word tokens, preserving their absolute offsets.
    // A "word" here is any run of non-whitespace characters.
    const tokenPattern = /\S+/g;
    const candidates: Array<{ from: number; to: number; text: string; score: number }> = [];

    for (const m of doc.matchAll(tokenPattern)) {
      const tokenText = m[0];
      const tokenFrom = m.index ?? 0;
      const result = fuzzyMatch(tokenText, query, caseSensitive);
      if (result.matched) {
        candidates.push({
          from: tokenFrom,
          to: tokenFrom + tokenText.length,
          text: tokenText,
          score: result.score,
        });
      }
    }

    // Sort best score first so callers can take the top-N most relevant.
    candidates.sort((a, b) => b.score - a.score);

    return candidates.map(({ from, to, text }) => ({ from, to, text }));
  }

  // --- Exact / regexp / wholeWord path (unchanged) --------------------------
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

function resolveLabels(view: EditorView, labels: Partial<SearchPluginLabels> | undefined): SearchPluginLabels {
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
  private readonly labels: SearchPluginLabels;
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
    this.regexpField = this.createCheckbox("markdown-search-regexp-toggle", "re", this.query.regexp);
    this.wholeWordField = this.createCheckbox("markdown-search-word-toggle", "word", this.query.wholeWord);

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

  private createCheckbox(testId: string, name: string, checked: boolean): HTMLInputElement {
    const input = document.createElement("input");
    input.dataset.testId = testId;
    input.type = "checkbox";
    input.name = name;
    input.setAttribute("form", "");
    input.checked = checked;
    input.addEventListener("change", () => this.commit());
    return input;
  }

  private commit(): void {
    const query = new SearchQuery({
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

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.regexpField.checked = query.regexp;
    this.wholeWordField.checked = query.wholeWord;
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
