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
import { EditorView, keymap, runScopeHandlers, type Panel, type ViewUpdate } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface SearchMatch {
  from: number;
  to: number;
  text: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
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

function buildSearchPattern(query: string, options: SearchOptions = {}): RegExp {
  const flags = options.caseSensitive ? "g" : "gi";
  const escaped = escapeRegExp(query);
  const source = options.wholeWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(source, flags);
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

  return doc.replace(buildSearchPattern(query, options), replacement);
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

type SearchIconName = "previous" | "next" | "all" | "close";

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

  switch (name) {
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
    case "close":
      appendPath("M6 6l12 12");
      appendPath("m18 6-12 12");
      break;
  }

  return svg;
}

function createTextActionButton(
  testId: string,
  name: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = createButton(testId, name, label, onClick);
  button.classList.add("nexus-search-text-button");
  return button;
}

let rowId = 0;

function createIconButton(
  testId: string,
  name: string,
  label: string,
  icon: SearchIconName,
  onClick: () => void
): HTMLButtonElement {
  const button = createButton(testId, name, label, onClick);
  button.classList.add("nexus-search-icon-button");
  button.title = label;
  button.textContent = "";
  button.appendChild(createIcon(icon));
  return button;
}

function createLabel(input: HTMLInputElement, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "nexus-search-option";
  label.append(input, text);
  return label;
}

function searchPanelTheme() {
  return EditorView.theme({
    ".nexus-search-panel": {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      padding: "10px 12px",
      borderBottom: "1px solid var(--nexus-border, #e2e8f0)",
      backgroundColor: "var(--nexus-bg-subtle, #f8fafc)",
      fontSize: "13px",
      zIndex: "10",
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      overflow: "visible",
      minWidth: "0"
    },
    "& .cm-panels": {
      overflow: "visible"
    },
    ".nexus-search-find-row, .nexus-search-replace-row": {
      flexWrap: "wrap"
    },
    ".nexus-search-row": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minWidth: "0",
      width: "100%"
    },
    ".nexus-search-find-row.nexus-search-row": {
      display: "block",
      width: "100%"
    },
    ".nexus-search-find-field": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 30px",
      columnGap: "10px",
      alignItems: "center",
      width: "100%",
      minWidth: "0"
    },
    ".nexus-search-find-field .cm-textfield": {
      gridColumn: "1",
      width: "100%",
      maxWidth: "100%",
      minWidth: "0",
      boxSizing: "border-box",
      height: "30px",
      margin: "0",
      padding: "0 10px",
      lineHeight: "28px",
      borderRadius: "6px",
      border: "1px solid var(--nexus-border, #d0d7de)",
      backgroundColor: "var(--nexus-bg, #fff)",
      appearance: "none"
    },
    ".nexus-search-find-field .nexus-search-close": {
      gridColumn: "2",
      width: "30px",
      height: "30px",
      minWidth: "30px",
      margin: "0",
      padding: "0",
      boxSizing: "border-box",
      appearance: "none"
    },
    ".nexus-search-replace-row .cm-textfield": {
      flex: "1 1 10rem",
      minWidth: "0",
      height: "30px",
      padding: "4px 10px",
      borderRadius: "6px",
      border: "1px solid var(--nexus-border, #d0d7de)",
      backgroundColor: "var(--nexus-bg, #fff)"
    },
    ".nexus-search-options": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px 12px",
      padding: "2px 2px 0"
    },
    ".nexus-search-options-checks": {
      display: "inline-flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "8px 16px",
      minWidth: "0"
    },
    ".nexus-search-options-toolbar": {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      flexShrink: "0",
      marginLeft: "auto"
    },
    ".nexus-search-option": {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      whiteSpace: "nowrap",
      cursor: "pointer",
      userSelect: "none",
      color: "var(--nexus-text-muted, #64748b)",
      fontSize: "12px"
    },
    ".nexus-search-toolbar": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      flexShrink: "0"
    },
    ".nexus-search-match-count": {
      flexShrink: "0",
      minWidth: "2.75rem",
      textAlign: "center",
      color: "var(--nexus-text-muted, #64748b)",
      fontSize: "12px",
      fontVariantNumeric: "tabular-nums",
      padding: "0 2px"
    },
    ".nexus-search-button-group": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      flexShrink: "0"
    },
    ".nexus-search-panel .cm-button": {
      margin: "0",
      minWidth: "0",
      boxSizing: "border-box"
    },
    ".nexus-search-icon-button": {
      width: "30px",
      height: "30px",
      minWidth: "30px",
      padding: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "6px",
      flexShrink: "0"
    },
    ".nexus-search-text-button": {
      height: "30px",
      padding: "0 12px",
      fontSize: "12px",
      fontWeight: "500",
      whiteSpace: "nowrap",
      flexShrink: "0",
      borderRadius: "6px"
    },
    ".nexus-search-replace-actions": {
      gap: "6px",
      marginLeft: "auto",
      flexWrap: "wrap",
      justifyContent: "flex-end"
    },
    ".nexus-search-close": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: "0",
      fontSize: "16px",
      flexShrink: "0",
      borderRadius: "6px",
      border: "1px solid var(--nexus-border, #d0d7de)",
      backgroundColor: "var(--nexus-bg, #fff)",
      color: "var(--nexus-text-muted, #64748b)",
      transform: "translateY(4px)"
    }
  });
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
  private readonly matchCountEl: HTMLSpanElement;

  constructor(
    private readonly view: EditorView,
    readonly top: boolean,
    labels: Partial<SearchPluginLabels> | undefined
  ) {
    this.query = getSearchQuery(view.state);
    const resolvedLabels = resolveLabels(view, labels);

    this.matchCountEl = document.createElement("span");
    this.matchCountEl.className = "nexus-search-match-count";
    this.matchCountEl.dataset.testId = "markdown-search-match-count";
    this.matchCountEl.setAttribute("aria-live", "polite");

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
    searchRow.classList.add("nexus-search-find-row");
    const canReplace = !view.state.readOnly;

    const toolbarGroup = document.createElement("div");
    toolbarGroup.className = "nexus-search-button-group nexus-search-toolbar";
    toolbarGroup.append(
      createIconButton("markdown-search-prev", "prev", resolvedLabels.previous, "previous", () =>
        findPrevious(view)
      ),
      createIconButton("markdown-search-next", "next", resolvedLabels.next, "next", () => findNext(view)),
      createIconButton("markdown-search-all", "select", resolvedLabels.all, "all", () => selectMatches(view))
    );

    const closeButton = createIconButton(
      "markdown-search-close",
      "close",
      resolvedLabels.close,
      "close",
      () => closeSearchPanel(view)
    );
    closeButton.classList.add("nexus-search-close");

    const findFieldWrap = document.createElement("div");
    findFieldWrap.className = "nexus-search-find-field";
    findFieldWrap.append(this.searchField, closeButton);

    searchRow.append(findFieldWrap);

    const optionsChecks = document.createElement("div");
    optionsChecks.className = "nexus-search-options-checks";
    optionsChecks.append(
      createLabel(this.caseField, resolvedLabels.matchCase),
      createLabel(this.regexpField, resolvedLabels.regexp),
      createLabel(this.wholeWordField, resolvedLabels.byWord)
    );

    const optionsToolbar = document.createElement("div");
    optionsToolbar.className = "nexus-search-options-toolbar";
    optionsToolbar.dataset.testId = "markdown-search-nav-row";
    optionsToolbar.append(this.matchCountEl, toolbarGroup);

    const optionsRow = document.createElement("div");
    optionsRow.className = "nexus-search-options";
    optionsRow.dataset.testId = "markdown-search-options-row";
    optionsRow.append(optionsChecks, optionsToolbar);

    this.dom.append(searchRow, optionsRow);

    if (canReplace) {
      const replaceRow = createSearchRow("markdown-search-replace-row");
      replaceRow.classList.add("nexus-search-replace-row");
      replaceRow.id = `markdown-search-replace-row-${++rowId}`;

      const replaceActions = document.createElement("div");
      replaceActions.className = "nexus-search-button-group nexus-search-replace-actions";
      replaceActions.append(
        createTextActionButton(
          "markdown-search-replace",
          "replace",
          resolvedLabels.replaceNext,
          () => replaceNext(view)
        ),
        createTextActionButton(
          "markdown-search-replace-all",
          "replaceAll",
          resolvedLabels.replaceAll,
          () => replaceAll(view)
        )
      );

      replaceRow.append(this.replaceField, replaceActions);
      this.dom.append(replaceRow);
    }

    this.updateMatchCount();
  }

  update(update: ViewUpdate): void {
    let queryChanged = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
          queryChanged = true;
        }
      }
    }

    if (queryChanged || update.selectionSet || update.docChanged) {
      this.updateMatchCount();
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
      replace: this.replaceField.value,
      literal: true
    });

    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    this.updateMatchCount();
  }

  private updateMatchCount(): void {
    const query = this.query;
    if (!query.search || !query.valid) {
      this.matchCountEl.textContent = "";
      return;
    }

    const ranges: Array<{ from: number; to: number }> = [];
    const cursor = query.getCursor(this.view.state);
    for (let i = 0; i < 1000; i++) {
      const next = cursor.next();
      if (next.done) {
        break;
      }
      ranges.push(next.value);
    }

    if (ranges.length === 0) {
      this.matchCountEl.textContent = "0";
      return;
    }

    const pos = this.view.state.selection.main.head;
    let currentIdx = ranges.findIndex((range) => pos >= range.from && pos <= range.to);
    if (currentIdx < 0) {
      currentIdx = ranges.findIndex((range) => range.from >= pos);
      if (currentIdx < 0) {
        currentIdx = ranges.length - 1;
      }
    }

    this.matchCountEl.textContent = `${currentIdx + 1} / ${ranges.length}`;
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
      this.updateMatchCount();
      return;
    }

    if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      this.commit();
      replaceNext(this.view);
      this.updateMatchCount();
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

/**
 * Open the CodeMirror search panel for the editor mounted in `container`.
 * Returns false when no `.cm-editor` view is found.
 */
export function openSearchPanelIn(container: HTMLElement): boolean {
  const editorEl = container.querySelector(".cm-editor");
  if (!editorEl) {
    return false;
  }

  const view = EditorView.findFromDOM(editorEl as HTMLElement);
  if (!view) {
    return false;
  }

  openSearchPanel(view);
  return true;
}

export function createSearchPlugin(options: SearchPluginOptions = {}): NexusPlugin {
  const cmExtensions = [
    search({
      top: options.top ?? true,
      caseSensitive: options.caseSensitive ?? false,
      literal: true,
      createPanel: (view) => new NexusSearchPanel(view, options.top ?? true, options.labels)
    }),
    keymap.of(searchKeymap),
    searchPanelTheme()
  ];

  if (options.highlightSelectionMatches ?? true) {
    cmExtensions.push(highlightSelectionMatches());
  }

  return {
    name: "plugin-search",
    cmExtensions
  };
}
