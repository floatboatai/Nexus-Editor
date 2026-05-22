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
  SearchQuery,
  selectMatches,
  setSearchQuery
} from "@codemirror/search";
import { keymap, runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface SearchMatch {
  from: number;
  to: number;
  text: string;
}

export interface FuzzySearchMatch extends SearchMatch {
  /**
   * Character offsets inside the source document that satisfied the fuzzy query.
   */
  indices: number[];
  /**
   * Higher values represent tighter matches with more boundary/contiguous hits.
   */
  score: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  fuzzy?: boolean;
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
   * Enable fuzzy search by default. Fuzzy search treats the query as an
   * ordered subsequence, for example "nxe" matches "Nexus Editor".
   */
  fuzzy?: boolean;
  /**
   * Highlight viewport matches for the current selection.
   */
  highlightSelectionMatches?: boolean;
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
  fuzzy: string;
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
  fuzzy: "Fuzzy",
  replaceNext: "Replace",
  replaceAll: "Replace all",
  close: "Close"
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForSearch(value: string, caseSensitive: boolean | undefined): string {
  return caseSensitive ? value : value.toLocaleLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = text[index - 1];
  const current = text[index];
  if (!previous || !current) {
    return true;
  }

  return (
    /[\s()[\]{}.,:;'"`_*~#!?/-]/.test(previous) ||
    (/[a-z]/.test(previous) && /[A-Z]/.test(current))
  );
}

function scoreFuzzyMatch(text: string, indices: number[], queryLength: number): number {
  const from = indices[0] ?? 0;
  const to = (indices[indices.length - 1] ?? from) + 1;
  let score = queryLength * 20 - (to - from - queryLength) * 2;

  for (let i = 0; i < indices.length; i += 1) {
    if (isWordBoundary(text, indices[i])) {
      score += 8;
    }
    if (i > 0 && indices[i] === indices[i - 1] + 1) {
      score += 10;
    }
  }

  return score;
}

function findNextFuzzyCandidate(
  text: string,
  query: string,
  from: number,
  options: SearchOptions
): FuzzySearchMatch | null {
  const normalizedText = normalizeForSearch(text, options.caseSensitive);
  const normalizedQuery = normalizeForSearch(query, options.caseSensitive);
  const first = normalizedQuery[0];

  for (let start = from; start < normalizedText.length; start += 1) {
    if (normalizedText[start] !== first) {
      continue;
    }

    const indices = [start];
    let queryIndex = 1;
    for (
      let index = start + 1;
      index < normalizedText.length && queryIndex < normalizedQuery.length;
      index += 1
    ) {
      if (normalizedText[index] === normalizedQuery[queryIndex]) {
        indices.push(index);
        queryIndex += 1;
      }
    }

    if (queryIndex === normalizedQuery.length) {
      const matchFrom = indices[0];
      const matchTo = indices[indices.length - 1] + 1;
      return {
        from: matchFrom,
        to: matchTo,
        text: text.slice(matchFrom, matchTo),
        indices,
        score: scoreFuzzyMatch(text, indices, normalizedQuery.length)
      };
    }
  }

  return null;
}

export function createFuzzySearchPattern(query: string): string {
  return Array.from(query).map(escapeRegExp).join("[^\\n]*?");
}

export function findFuzzySearchMatches(
  doc: string,
  query: string,
  options: SearchOptions = {}
): FuzzySearchMatch[] {
  if (!query) {
    return [];
  }

  const matches: FuzzySearchMatch[] = [];
  let lineStart = 0;

  for (const line of doc.split("\n")) {
    let offset = 0;
    while (offset < line.length) {
      const match = findNextFuzzyCandidate(line, query, offset, options);
      if (!match) {
        break;
      }

      const from = lineStart + match.from;
      matches.push({
        ...match,
        from,
        to: lineStart + match.to,
        indices: match.indices.map((index) => lineStart + index)
      });
      offset = match.to;
    }

    lineStart += line.length + 1;
  }

  return matches;
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
    return findFuzzySearchMatches(doc, query, options);
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const pattern = new RegExp(escapeRegExp(query), flags);
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

  const flags = options.caseSensitive ? "g" : "gi";
  return doc.replace(new RegExp(escapeRegExp(query), flags), replacement);
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
  private readonly labels: SearchPluginLabels;
  private readonly replaceRow?: HTMLDivElement;
  private readonly replaceToggle?: IconButtonElements;
  private replaceExpanded = false;

  constructor(
    private readonly view: EditorView,
    readonly top: boolean,
    options: SearchPluginOptions
  ) {
    this.query = getSearchQuery(view.state);
    const resolvedLabels = resolveLabels(view, options.labels);
    this.labels = resolvedLabels;

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
    this.fuzzyField = this.createCheckbox("markdown-search-fuzzy-toggle", "fuzzy", options.fuzzy ?? false);

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
        findPrevious(view)
      ),
      createIconButton("markdown-search-next", "next", resolvedLabels.next, "next", () => findNext(view)),
      createIconButton("markdown-search-all", "select", resolvedLabels.all, "all", () => selectMatches(view))
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

    const closeButton = createButton("markdown-search-close", "close", "×", () => closeSearchPanel(view));
    closeButton.setAttribute("aria-label", resolvedLabels.close);
    closeButton.title = resolvedLabels.close;
    this.dom.append(closeButton);
    this.syncSearchModeControls();
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
    input.addEventListener("input", () => this.commit());
    input.addEventListener("change", () => this.commit());
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
    input.addEventListener("change", () => {
      this.syncSearchModeControls();
      this.commit();
    });
    return input;
  }

  private commit(): void {
    const fuzzy = this.fuzzyField.checked;
    const query = new SearchQuery({
      search: fuzzy ? createFuzzySearchPattern(this.searchField.value) : this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: fuzzy || this.regexpField.checked,
      wholeWord: fuzzy ? false : this.wholeWordField.checked,
      replace: this.replaceField.value
    });

    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
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
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      this.commit();
      (event.shiftKey ? findPrevious : findNext)(this.view);
      return;
    }

    if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      this.commit();
      replaceNext(this.view);
    }
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseField.checked = query.caseSensitive;
    this.regexpField.checked = query.regexp;
    this.wholeWordField.checked = query.wholeWord;
    this.fuzzyField.checked = false;
    this.syncSearchModeControls();
  }

  private syncSearchModeControls(): void {
    const fuzzy = this.fuzzyField.checked;
    this.regexpField.disabled = fuzzy;
    this.wholeWordField.disabled = fuzzy;
  }
}

export function createSearchPlugin(options: SearchPluginOptions = {}): NexusPlugin {
  const cmExtensions = [
    search({
      top: options.top ?? true,
      caseSensitive: options.caseSensitive ?? false,
      literal: true,
      createPanel: (view) => new NexusSearchPanel(view, options.top ?? true, options)
    }),
    keymap.of(searchKeymap)
  ];

  if (options.highlightSelectionMatches ?? true) {
    cmExtensions.push(highlightSelectionMatches());
  }

  return {
    name: "plugin-search",
    cmExtensions
  };
}
