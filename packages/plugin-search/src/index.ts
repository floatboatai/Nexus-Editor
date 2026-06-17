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

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
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
  private readonly replaceRow?: HTMLDivElement;
  private readonly replaceToggle?: IconButtonElements;
  private replaceExpanded = false;

  constructor(
    private readonly view: EditorView,
    readonly top: boolean,
    labels: Partial<SearchPluginLabels> | undefined
  ) {
    this.query = getSearchQuery(view.state);
    const resolvedLabels = resolveLabels(view, labels);
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
  }
}

export function createSearchPlugin(options: SearchPluginOptions = {}): NexusPlugin {
  const cmExtensions = [
    search({
      top: options.top ?? true,
      caseSensitive: options.caseSensitive ?? false,
      literal: true,
      createPanel: (view) => new NexusSearchPanel(view, options.top ?? true, options.labels)
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
