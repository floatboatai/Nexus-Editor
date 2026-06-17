/**
 * Vanilla-DOM status-bar widget that subscribes to a
 * {@link WordCountAPI} and renders word count, character count, and
 * reading time in a single ARIA-live region.
 *
 * The bar is intentionally framework-agnostic — wrap it in a portal /
 * teleport for React / Vue hosts. The bar never parses Markdown
 * itself; all stats are read from the plugin's subscription stream.
 */

import type { WordCountStats } from "./count";
import type { WordCountAPI, WordCountState } from "./plugin";

export interface WordCountLabels {
  /** Plural word count label, e.g. `"words"` / `"个词"`. */
  words: string;
  /** Character count label. */
  characters: string;
  /** Character (no spaces) label, used when {@link StatusBarOptions.showCharactersNoSpaces} is on. */
  charactersNoSpaces: string;
  /** Reading-time suffix shown after the duration, e.g. `"min read"`. */
  readingTime: string;
  /** Reading-time text for ≤ 60 seconds, e.g. `"< 1 min read"`. */
  readingTimeShort: string;
  /** Selection summary prefix, e.g. `"Selected"`. */
  selection: string;
}

export const defaultStatusBarLabels: WordCountLabels = Object.freeze({
  words: "words",
  characters: "chars",
  charactersNoSpaces: "chars (no spaces)",
  readingTime: "min read",
  readingTimeShort: "< 1 min read",
  selection: "Selected"
});

export interface StatusBarOptions {
  /** Element to append the bar to. Defaults to `document.body`. */
  container?: HTMLElement;
  /** Override visible strings — partial overrides merge with defaults. */
  labels?: Partial<WordCountLabels>;
  /** BCP-47 locale for `Intl.NumberFormat`. Defaults to host default. */
  locale?: string | string[];
  /**
   * Render the second character figure (no whitespace). Default `false`
   * — keeps the bar compact for narrow layouts.
   */
  showCharactersNoSpaces?: boolean;
  /**
   * Render the reading-time span. Default `true`.
   */
  showReadingTime?: boolean;
  /**
   * Render the selection summary when a selection is active. Default
   * `true`.
   */
  showSelection?: boolean;
  /**
   * CSS class prefix for theming. Default `nexus-wordcount`.
   */
  classPrefix?: string;
}

export interface StatusBarHandle {
  /** Root element of the bar. Useful for portal teleporting or styling. */
  element: HTMLElement;
  /** Detach the bar and unsubscribe from the plugin. */
  destroy(): void;
}

/**
 * Mount a status-bar widget bound to `plugin`. Idempotent for the same
 * plugin: each call returns an independent bar — callers wanting a
 * single bar should keep the returned handle and call `destroy()`
 * before re-creating.
 */
export function createStatusBar(plugin: WordCountAPI, options: StatusBarOptions = {}): StatusBarHandle {
  const labels: WordCountLabels = { ...defaultStatusBarLabels, ...options.labels };
  const classPrefix = options.classPrefix ?? "nexus-wordcount";
  const showCharactersNoSpaces = options.showCharactersNoSpaces ?? false;
  const showReadingTime = options.showReadingTime ?? true;
  const showSelection = options.showSelection ?? true;

  const formatter = new Intl.NumberFormat(options.locale);

  const root = document.createElement("div");
  root.className = `${classPrefix}__bar`;
  root.dataset.testId = "nexus-wordcount-bar";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const wordsSpan = createSpan(root, classPrefix, "words", "nexus-wordcount-words");
  const charactersSpan = createSpan(root, classPrefix, "characters", "nexus-wordcount-characters");
  const charactersNoSpacesSpan = showCharactersNoSpaces
    ? createSpan(root, classPrefix, "characters-no-spaces", "nexus-wordcount-characters-no-spaces")
    : null;
  const readingTimeSpan = showReadingTime
    ? createSpan(root, classPrefix, "reading-time", "nexus-wordcount-reading-time")
    : null;
  const selectionSpan = showSelection
    ? createSpan(root, classPrefix, "selection", "nexus-wordcount-selection")
    : null;
  if (selectionSpan) {
    selectionSpan.hidden = true;
    selectionSpan.setAttribute("aria-hidden", "true");
  }

  const container = options.container ?? document.body;
  container.appendChild(root);

  const render = (state: WordCountState): void => {
    renderDoc(state.doc);
    if (selectionSpan) {
      if (state.isSelectionActive) {
        selectionSpan.hidden = false;
        selectionSpan.removeAttribute("aria-hidden");
        selectionSpan.textContent = formatSelection(state.selection, labels, formatter);
      } else {
        selectionSpan.hidden = true;
        selectionSpan.setAttribute("aria-hidden", "true");
        selectionSpan.textContent = "";
      }
    }
  };

  const renderDoc = (stats: WordCountStats): void => {
    wordsSpan.textContent = `${formatter.format(stats.words)} ${labels.words}`;
    charactersSpan.textContent = `${formatter.format(stats.characters)} ${labels.characters}`;
    if (charactersNoSpacesSpan) {
      charactersNoSpacesSpan.textContent = `${formatter.format(stats.charactersNoSpaces)} ${labels.charactersNoSpaces}`;
    }
    if (readingTimeSpan) {
      readingTimeSpan.textContent = formatReadingTime(stats.readingTimeSeconds, labels);
    }
  };

  const unsubscribe = plugin.subscribe(render);

  return {
    element: root,
    destroy() {
      unsubscribe();
      root.remove();
    }
  };
}

function createSpan(parent: HTMLElement, prefix: string, suffix: string, testId: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `${prefix}__${suffix}`;
  span.dataset.testId = testId;
  parent.appendChild(span);
  return span;
}

function formatReadingTime(seconds: number, labels: WordCountLabels): string {
  if (seconds <= 60) {
    return labels.readingTimeShort;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${labels.readingTime}`;
}

function formatSelection(stats: WordCountStats, labels: WordCountLabels, formatter: Intl.NumberFormat): string {
  return `${labels.selection}: ${formatter.format(stats.words)} ${labels.words} · ${formatter.format(stats.characters)} ${labels.characters}`;
}
