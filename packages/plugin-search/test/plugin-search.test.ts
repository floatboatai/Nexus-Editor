import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "../../preset-gfm/src/index";
import {
  createSearchPlugin,
  findFuzzyMatches,
  findSearchMatches,
  replaceAllMatches,
  type SearchPluginLabels
} from "../src/index";

const HISTORY_KEY = "nexus:test-search-history";
const TABLE_SEARCH_HIGHLIGHT_PREFIX = "nexus-table-search-";
const SEARCH_LINK_MATCH_ATTRIBUTE = "data-nexus-search-link-match";
const SEARCH_LINK_ACTIVE_MATCH_CLASS = "nexus-search-link-match-active";
const SEARCH_ACTIVE_MATCH_CLASS = "nexus-search-active-match";

class FakeHighlight {
  readonly ranges: Range[];

  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function installCssHighlightMock() {
  const win = window as unknown as Window & {
    CSS?: { highlights?: Map<string, FakeHighlight> };
    Highlight?: typeof FakeHighlight;
  };
  const previousCss = win.CSS;
  const previousHighlight = win.Highlight;
  const registry = new Map<string, FakeHighlight>();

  Object.defineProperty(win, "CSS", {
    configurable: true,
    value: {
      ...(previousCss ?? {}),
      highlights: registry
    }
  });
  Object.defineProperty(win, "Highlight", {
    configurable: true,
    value: FakeHighlight
  });

  return {
    registry,
    restore() {
      Object.defineProperty(win, "CSS", {
        configurable: true,
        value: previousCss
      });
      Object.defineProperty(win, "Highlight", {
        configurable: true,
        value: previousHighlight
      });
    }
  };
}

function readHighlightText(highlight: FakeHighlight | undefined): string {
  return highlight?.ranges.map((range) => range.toString()).join("") ?? "";
}

function readTableHighlightTexts(
  registry: Map<string, FakeHighlight>,
  kind: "match" | "selected"
): string[] {
  return Array.from(registry.entries())
    .filter(
      ([name]) =>
        name.startsWith(TABLE_SEARCH_HIGHLIGHT_PREFIX) && name.endsWith(`-${kind}`)
    )
    .map(([, highlight]) => readHighlightText(highlight));
}

function createEmptyRect(): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({})
  };
}

function createRectList(): DOMRectList {
  const rect = createEmptyRect();
  return {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: function* () {
      yield rect;
    }
  } as DOMRectList;
}

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => createRectList()
  });
}

if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => createEmptyRect()
  });
}

interface MemoryHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readHistory(): string[];
  readRaw(): string | null;
}

function createMemoryHistoryStorage(initialRaw?: string): MemoryHistoryStorage {
  const values = new Map<string, string>();
  if (initialRaw !== undefined) {
    values.set(HISTORY_KEY, initialRaw);
  }

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    readHistory() {
      const raw = values.get(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    },
    readRaw() {
      return values.get(HISTORY_KEY) ?? null;
    }
  };
}

function historyOptions(
  options: {
    storage?: Pick<MemoryHistoryStorage, "getItem" | "setItem">;
    maxEntries?: number;
  } = {}
): Parameters<typeof createSearchPlugin>[0] {
  return {
    history: {
      storage: options.storage,
      storageKey: HISTORY_KEY,
      maxEntries: options.maxEntries
    }
  } as Parameters<typeof createSearchPlugin>[0];
}

function openSearchPanel(container: HTMLElement): HTMLInputElement {
  const content = container.querySelector<HTMLElement>(".cm-content");
  expect(content).not.toBeNull();

  content?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
  );
  if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
  }

  const input = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-input"]');
  expect(input).not.toBeNull();
  return input!;
}

function setupSearchPanel(
  options: Parameters<typeof createSearchPlugin>[0] = {},
  initialValue = "alpha beta gamma alpha"
) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container,
    initialValue,
    plugins: [createSearchPlugin(options)]
  });
  const input = openSearchPanel(container);

  return {
    editor,
    container,
    input,
    destroy() {
      editor.destroy();
      container.remove();
    }
  };
}

function submitSearch(input: HTMLInputElement, value: string): KeyboardEvent {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true
  });
  input.dispatchEvent(event);
  return event;
}

function pressInputArrow(input: HTMLInputElement, key: "ArrowUp" | "ArrowDown"): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true
  });
  input.dispatchEvent(event);
  return event;
}

describe("@floatboat/nexus-plugin-search", () => {
  it("finds all case-insensitive matches in a document", () => {
    expect(findSearchMatches("Hello hello HELLO", "hello")).toEqual([
      { from: 0, to: 5, text: "Hello" },
      { from: 6, to: 11, text: "hello" },
      { from: 12, to: 17, text: "HELLO" }
    ]);
  });

  it("supports case-sensitive search", () => {
    expect(findSearchMatches("Hello hello HELLO", "hello", { caseSensitive: true })).toEqual([
      { from: 6, to: 11, text: "hello" }
    ]);
  });

  it("finds ordered fuzzy matches and ranks contiguous results first", () => {
    expect(findFuzzyMatches("abc axxb", "ab")).toEqual([
      { from: 0, to: 2, text: "ab", positions: [0, 1], score: 0 },
      { from: 4, to: 8, text: "axxb", positions: [4, 7], score: 22 }
    ]);
  });

  it("bounds fuzzy results while retaining the best-ranked matches", () => {
    expect(findFuzzyMatches("axxb ab", "ab", { maxResults: 1 })).toEqual([
      { from: 5, to: 7, text: "ab", positions: [5, 6], score: 5 }
    ]);
  });

  it("does not match across punctuation or whitespace", () => {
    expect(findFuzzyMatches("w..f w/f w?f w,f workflow", "wf").map((match) => match.text)).toEqual([
      "workf"
    ]);
  });

  it("respects case sensitivity for fuzzy search", () => {
    expect(findFuzzyMatches("Nexus nexus", "nxs")).toHaveLength(2);
    expect(findFuzzyMatches("Nexus nexus", "nxs", { caseSensitive: true })).toEqual([
      { from: 6, to: 11, text: "nexus", positions: [6, 8, 10], score: 30 }
    ]);
  });

  it("returns no fuzzy matches for an empty query", () => {
    expect(findFuzzyMatches("Nexus", "")).toEqual([]);
  });

  it("supports whole-word matching", () => {
    expect(findSearchMatches("cat cats catalog", "cat", { wholeWord: true })).toEqual([
      { from: 0, to: 3, text: "cat" }
    ]);
  });

  it("supports case-sensitive whole-word matching", () => {
    expect(findSearchMatches("cat Cat CAT", "Cat", { wholeWord: true, caseSensitive: true })).toEqual([
      { from: 4, to: 7, text: "Cat" }
    ]);
  });

  it("replaces all matches in a document", () => {
    expect(replaceAllMatches("cat scatter cat", "cat", "dog")).toBe("dog sdogter dog");
  });

  it("replaces only whole-word matches", () => {
    expect(replaceAllMatches("cat catalog cat concatenate", "cat", "dog", { wholeWord: true })).toBe(
      "dog catalog dog concatenate"
    );
  });

  it("supports regex search", () => {
    expect(findSearchMatches("foo123 bar456 baz", "\\d+", { regexp: true })).toEqual([
      { from: 3, to: 6, text: "123" },
      { from: 10, to: 13, text: "456" }
    ]);
  });

  it("supports regex search with groups", () => {
    expect(findSearchMatches("2024-01-15 and 2024-12-31", "\\d{4}-\\d{2}-\\d{2}", { regexp: true })).toEqual([
      { from: 0, to: 10, text: "2024-01-15" },
      { from: 15, to: 25, text: "2024-12-31" }
    ]);
  });

  it("supports case-sensitive regex search", () => {
    expect(findSearchMatches("Hello hello HELLO", "h.llo", { regexp: true, caseSensitive: true })).toEqual([
      { from: 6, to: 11, text: "hello" }
    ]);
  });

  it("returns empty results for invalid regex", () => {
    expect(findSearchMatches("hello world", "[invalid(", { regexp: true })).toEqual([]);
  });

  it("replaces with regex capture groups", () => {
    expect(replaceAllMatches("foo bar baz", "(\\w+)", "[$1]", { regexp: true })).toBe("[foo] [bar] [baz]");
  });

  it("returns original doc for invalid regex in replace", () => {
    expect(replaceAllMatches("hello world", "[bad(", "x", { regexp: true })).toBe("hello world");
  });

  it("supports regex with whole-word combined", () => {
    expect(findSearchMatches("cat cats concatenate", "cat|dog", { regexp: true, wholeWord: true })).toEqual([
      { from: 0, to: 3, text: "cat" }
    ]);
  });

  it("creates a search plugin descriptor", () => {
    const plugin = createSearchPlugin();

    expect(plugin.name).toBe("plugin-search");
    expect(plugin.cmExtensions).toHaveLength(6);
  });

  it("accepts deprecated label overrides for source compatibility", () => {
    const plugin = createSearchPlugin({
      labels: {
        showReplace: "Show replace",
        hideReplace: "Hide replace",
        all: "All",
        matchCase: "Match case",
        regexp: "Regexp",
        byWord: "By word"
      }
    });

    expect(plugin.name).toBe("plugin-search");
  });

  it("keeps existing complete label objects source-compatible", () => {
    const legacyLabels: SearchPluginLabels = {
      find: "Find",
      replace: "Replace",
      next: "Next",
      previous: "Previous",
      replaceNext: "Replace",
      replaceAll: "Replace all",
      close: "Close",
      showReplace: "Show replace",
      hideReplace: "Hide replace",
      all: "All",
      matchCase: "Match case",
      regexp: "Regexp",
      byWord: "By word"
    };

    expect(createSearchPlugin({ labels: legacyLabels }).name).toBe("plugin-search");
  });

  it("navigates and decorates fuzzy matches without changing literal search", () => {
    const harness = setupSearchPanel();
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzyButton).not.toBeNull();

    fuzzyButton!.click();
    const submit = submitSearch(harness.input, "lph");

    expect(submit.defaultPrevented).toBe(true);
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).map((element) => element.textContent)
    ).toEqual(["l", "p", "h", "l", "p", "h"]);
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match-active`)).map(
        (element) => element.textContent
      )
    ).toEqual(["l", "p", "h"]);
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).findIndex((element) =>
        element.classList.contains("nexus-search-fuzzy-match-active")
      )
    ).toBe(0);

    submitSearch(harness.input, "lph");
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).map((element) => element.textContent)
    ).toEqual(["l", "p", "h", "l", "p", "h"]);
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match-active`)).map(
        (element) => element.textContent
      )
    ).toEqual(["l", "p", "h"]);
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).findIndex((element) =>
        element.classList.contains("nexus-search-fuzzy-match-active")
      )
    ).toBe(3);

    harness.destroy();
  });

  it("navigates fuzzy matches from top to bottom instead of by match score", () => {
    const harness = setupSearchPanel({}, "axxb ab");
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzyButton).not.toBeNull();

    fuzzyButton!.click();
    submitSearch(harness.input, "ab");
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).findIndex((element) =>
        element.classList.contains("nexus-search-fuzzy-match-active")
      )
    ).toBe(0);

    submitSearch(harness.input, "ab");
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(
      Array.from(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).findIndex((element) =>
        element.classList.contains("nexus-search-fuzzy-match-active")
      )
    ).toBe(2);

    harness.destroy();
  });

  it("clears a stale editor selection when the fuzzy query changes", () => {
    const harness = setupSearchPanel({}, "ai fl");
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzyButton).not.toBeNull();

    fuzzyButton!.click();
    submitSearch(harness.input, "ai");
    harness.editor.setSelection(0, 2);
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 2 });

    harness.input.value = "fl";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(harness.container.querySelectorAll(`.nexus-search-fuzzy-match-active`)).toHaveLength(0);

    harness.destroy();
  });

  it("clears a stale editor selection when a normal query is shortened or cleared", () => {
    const harness = setupSearchPanel({}, "ai fl");

    harness.input.value = "ai";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    harness.editor.setSelection(0, 2);

    harness.input.value = "a";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });

    harness.editor.setSelection(0, 1);
    harness.input.value = "";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });

    harness.destroy();
  });

  it("toggles fuzzy mode and disables replacement controls", () => {
    const harness = setupSearchPanel();
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    const replaceButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-replace"]'
    );
    const replaceInput = harness.container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-replace-input"]'
    );
    const replaceAllButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-replace-all"]'
    );
    expect(fuzzyButton).not.toBeNull();

    fuzzyButton!.click();

    expect(fuzzyButton?.getAttribute("aria-pressed")).toBe("true");
    expect(fuzzyButton?.dataset.active).toBe("true");
    expect(replaceInput?.disabled).toBe(true);
    expect(replaceButton?.disabled).toBe(true);
    expect(replaceAllButton?.disabled).toBe(true);

    fuzzyButton!.click();
    expect(fuzzyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(fuzzyButton?.dataset.active).toBe("false");
    expect(replaceInput?.disabled).toBe(false);

    harness.destroy();
  });

  it("shows a fuzzy zero-result status", () => {
    const harness = setupSearchPanel();
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    const status = harness.container.querySelector<HTMLElement>(
      '[data-test-id="markdown-search-fuzzy-status"]'
    );
    expect(fuzzyButton).not.toBeNull();
    expect(status).not.toBeNull();

    fuzzyButton!.click();
    harness.input.value = "zzz";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("No fuzzy matches");
    expect(status?.parentElement).toBe(
      harness.container.querySelector('[data-test-id="markdown-search-bar"]')
    );

    harness.destroy();
  });

  it("clears fuzzy decorations when the search panel closes", () => {
    const harness = setupSearchPanel();
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    const closeButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-close"]'
    );
    expect(fuzzyButton).not.toBeNull();
    expect(closeButton).not.toBeNull();

    fuzzyButton!.click();
    harness.input.value = "lph";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).toHaveLength(6);

    closeButton!.click();
    expect(harness.container.querySelectorAll(`.nexus-search-fuzzy-match`)).toHaveLength(0);

    harness.destroy();
  });

  it("removes an open search tooltip when the panel is destroyed", () => {
    const harness = setupSearchPanel();
    const fuzzyButton = harness.container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzyButton).not.toBeNull();

    fuzzyButton!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const tooltipId = fuzzyButton!.getAttribute("aria-describedby");
    expect(document.getElementById(tooltipId ?? "")?.textContent).toBe("Fuzzy");

    harness.destroy();
    expect(document.getElementById(tooltipId ?? "")).toBeNull();
  });

  it("highlights fuzzy matches in rendered links without changing link rendering", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "[query](https://example.com/query) after",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      editor.setSelection(editor.getDocument().length);
      const input = openSearchPanel(container);
      const fuzzyButton = container.querySelector<HTMLButtonElement>(
        '[data-test-id="markdown-search-fuzzy-toggle"]'
      );
      expect(fuzzyButton).not.toBeNull();

      fuzzyButton!.click();
      input.value = "qu";
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      const nextButton = container.querySelector<HTMLButtonElement>(
        '[data-test-id="markdown-search-next"]'
      );
      expect(nextButton).not.toBeNull();
      nextButton!.click();
      await Promise.resolve();

      const link = container.querySelector<HTMLElement>("[data-link-url]");
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe("query");
      expect(link?.querySelectorAll(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)).toHaveLength(1);
      expect(link?.querySelector(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)?.textContent).toBe("qu");
      expect(
        link?.querySelector(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)?.classList.contains(
          SEARCH_LINK_ACTIVE_MATCH_CLASS
        )
      ).toBe(true);

      const closeButton = container.querySelector<HTMLButtonElement>(
        '[data-test-id="markdown-search-close"]'
      );
      expect(closeButton).not.toBeNull();
      closeButton!.click();
      await Promise.resolve();
      expect(container.querySelector("[data-link-url]")).not.toBeNull();
      expect(container.querySelector(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)).toBeNull();
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  it("highlights normal matches in rendered links without changing link rendering", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "[query](https://example.com/query) after",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      editor.setSelection(editor.getDocument().length);
      const input = openSearchPanel(container);
      submitSearch(input, "query");
      await Promise.resolve();

      const link = container.querySelector<HTMLElement>("[data-link-url]");
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe("query");
      expect(link?.querySelectorAll(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)).toHaveLength(1);
      expect(link?.querySelector(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)?.textContent).toBe("query");
      expect(
        link?.querySelector(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)?.classList.contains(
          SEARCH_LINK_ACTIVE_MATCH_CLASS
        )
      ).toBe(true);
      expect(editor.getSelection()).toEqual({
        anchor: editor.getDocument().length,
        head: editor.getDocument().length
      });
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  it("marks only the current fuzzy result inside adjacent links", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue:
        "[QureQure](https://example.com/QureQure) [Qure](https://example.com/Qure) after",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      editor.setSelection(editor.getDocument().length);
      const input = openSearchPanel(container);
      const fuzzyButton = container.querySelector<HTMLButtonElement>(
        '[data-test-id="markdown-search-fuzzy-toggle"]'
      );
      expect(fuzzyButton).not.toBeNull();
      fuzzyButton!.click();

      submitSearch(input, "qr");
      await Promise.resolve();

      const links = container.querySelectorAll<HTMLElement>("[data-link-url]");
      expect(links).toHaveLength(2);
      expect(links[0].querySelectorAll(`[${SEARCH_LINK_MATCH_ATTRIBUTE}="true"]`)).toHaveLength(4);
      expect(links[0].querySelectorAll(`.${SEARCH_LINK_ACTIVE_MATCH_CLASS}`)).toHaveLength(2);
      expect(links[1].querySelectorAll(`.${SEARCH_LINK_ACTIVE_MATCH_CLASS}`)).toHaveLength(0);

      submitSearch(input, "qr");
      await Promise.resolve();
      expect(links[0].querySelectorAll(`.${SEARCH_LINK_ACTIVE_MATCH_CLASS}`)).toHaveLength(2);
      expect(links[1].querySelectorAll(`.${SEARCH_LINK_ACTIVE_MATCH_CLASS}`)).toHaveLength(0);
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  it("highlights rendered table cell matches through CSS Highlight ranges", () => {
    const highlightSupport = installCssHighlightMock();
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: [
        "| Name | Status |",
        "| --- | --- |",
        "| SearchNeedle070 | Todo |",
        "| Other | Done |"
      ].join("\n"),
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      const input = openSearchPanel(container);

      submitSearch(input, "SearchNeedle070");

      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["SearchNeedle070"]);
      expect(container.querySelector(".nexus-table-wrapper")?.textContent).toContain("SearchNeedle070");
    } finally {
      editor.destroy();
      container.remove();
      highlightSupport.restore();
    }
  });

  it("maps rich table matches to their exact Markdown source ranges", () => {
    const highlightSupport = installCssHighlightMock();
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: [
        "| Strong | Split | Link | Hidden URL | Repeated label | Double code |",
        "| --- | --- | --- | --- | --- | --- |",
        "| **RichNeedle** | **ab**cd | [Label](https://x) | [Shown](https://x.test/HiddenNeedle) | [RepeatedLabel](https://x.test/RepeatedLabel) | ``CodeNeedle`` |"
      ].join("\n"),
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      const input = openSearchPanel(container);

      submitSearch(input, "RichNeedle");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["RichNeedle"]);

      submitSearch(input, "bc");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);

      submitSearch(input, "Label");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([
        "labelLabelLabel"
      ]);

      submitSearch(input, "HiddenNeedle");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);

      submitSearch(input, "RepeatedLabel");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["RepeatedLabel"]);

      submitSearch(input, "CodeNeedle");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["CodeNeedle"]);
    } finally {
      editor.destroy();
      container.remove();
      highlightSupport.restore();
    }
  });

  it("keeps table highlights when an unchanged table moves in the document", async () => {
    const highlightSupport = installCssHighlightMock();
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "| Value |\n| --- |\n| Label |",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      submitSearch(openSearchPanel(container), "Label");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["Label"]);

      editor.replaceRange(0, 0, "a longer prefix\n\n");
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect([
        ...readTableHighlightTexts(highlightSupport.registry, "selected"),
        ...readTableHighlightTexts(highlightSupport.registry, "match"),
      ]).toContain("Label");
    } finally {
      editor.destroy();
      container.remove();
      highlightSupport.restore();
    }
  });

  it("isolates table highlights between editors and clears them on close and destroy", () => {
    const highlightSupport = installCssHighlightMock();
    const firstContainer = document.createElement("div");
    const secondContainer = document.createElement("div");
    document.body.append(firstContainer, secondContainer);
    const initialStyleCount = document.querySelectorAll(
      "style[data-nexus-table-search-highlight]"
    ).length;
    const firstEditor = createEditor({
      container: firstContainer,
      initialValue: "| Value |\n| --- |\n| FirstNeedle |",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });
    const secondEditor = createEditor({
      container: secondContainer,
      initialValue: "| Value |\n| --- |\n| SecondNeedle |",
      livePreview: true,
      plugins: [createGfmPreset(), createSearchPlugin()]
    });

    try {
      submitSearch(openSearchPanel(firstContainer), "FirstNeedle");
      submitSearch(openSearchPanel(secondContainer), "SecondNeedle");

      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match").sort()).toEqual([
        "FirstNeedle",
        "SecondNeedle"
      ]);
      expect(
        document.querySelectorAll("style[data-nexus-table-search-highlight]").length
      ).toBe(initialStyleCount + 2);

      firstEditor.destroy();
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual(["SecondNeedle"]);
      expect(
        document.querySelectorAll("style[data-nexus-table-search-highlight]").length
      ).toBe(initialStyleCount + 1);

      secondContainer
        .querySelector<HTMLButtonElement>('[data-test-id="markdown-search-close"]')
        ?.click();
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);
      expect(
        document.querySelectorAll("style[data-nexus-table-search-highlight]").length
      ).toBe(initialStyleCount);
    } finally {
      firstEditor.destroy();
      secondEditor.destroy();
      firstContainer.remove();
      secondContainer.remove();
      highlightSupport.restore();
    }

    expect(document.querySelectorAll("style[data-nexus-table-search-highlight]").length).toBe(
      initialStyleCount
    );
  });

  it("opens a data-test-id annotated search panel from the editor keymap", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta alpha",
      plugins: [
        createSearchPlugin({
          labels: {
            find: "查找",
            next: "下一个",
            fuzzy: "模糊"
          }
        })
      ]
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    }

    const panel = container.querySelector<HTMLElement>('[data-test-id="markdown-search-bar"]');
    const input = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-input"]');
    expect(panel).not.toBeNull();
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe("查找");
    const row = container.querySelector<HTMLElement>('[data-test-id="markdown-search-find-row"]');
    const previousButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-prev"]'
    );
    const nextButton = container.querySelector<HTMLButtonElement>('[data-test-id="markdown-search-next"]');
    const fuzzyButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    const replaceInput = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-replace-input"]'
    );
    const replaceButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-replace"]'
    );
    const replaceAllButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-replace-all"]'
    );
    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-close"]'
    );
    expect(panel?.classList.contains("cm-search")).toBe(false);
    expect(nextButton?.textContent).toBe("");
    expect(nextButton?.title).toBe("");
    expect(nextButton?.getAttribute("aria-label")).toBe("下一个");
    const nextTooltipId = nextButton?.getAttribute("aria-describedby");
    expect(nextTooltipId).toMatch(/^nexus-search-tooltip-/);
    nextButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const nextTooltip = document.getElementById(nextTooltipId ?? "");
    expect(nextTooltip?.textContent).toBe("下一个");
    expect((nextTooltip as HTMLElement | null)?.style.position).toBe("fixed");
    nextButton?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(document.getElementById(nextTooltipId ?? "")).toBeNull();
    expect(nextButton?.querySelector("svg")).not.toBeNull();
    expect(previousButton?.querySelector("path")?.getAttribute("d")).toBe("m18 15-6-6-6 6");
    expect(nextButton?.querySelector("path")?.getAttribute("d")).toBe("m6 9 6 6 6-6");
    expect(container.querySelector('[data-test-id="markdown-search-all"]')).toBeNull();

    expect(row).not.toBeNull();
    expect(replaceInput?.parentElement).toBe(row);
    expect(row?.contains(replaceButton ?? null)).toBe(true);
    expect(row?.contains(replaceAllButton ?? null)).toBe(true);
    expect(row?.lastElementChild?.contains(closeButton ?? null)).toBe(true);
    expect(replaceInput?.hidden).toBe(false);
    expect(replaceButton?.textContent).toBe("Replace");
    expect(replaceAllButton?.textContent).toBe("Replace all");
    expect(container.querySelector('[data-test-id="markdown-search-toggle-replace"]')).toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-replace-row"]')).toBeNull();

    expect(fuzzyButton?.textContent).toBe("");
    expect(fuzzyButton?.getAttribute("aria-label")).toBe("模糊");
    expect(fuzzyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(fuzzyButton?.dataset.active).toBe("false");
    expect(fuzzyButton?.title).toBe("");
    expect(fuzzyButton?.getAttribute("aria-describedby")).toMatch(/^nexus-search-tooltip-/);
    expect(fuzzyButton?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-options"]')).toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-options-menu"]')).toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-case-toggle"]')).toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-regexp-toggle"]')).toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-word-toggle"]')).toBeNull();

    fuzzyButton?.click();
    expect(fuzzyButton?.getAttribute("aria-pressed")).toBe("true");
    expect(fuzzyButton?.dataset.active).toBe("true");

    editor.destroy();
    container.remove();
  });

  it("commits input events before Enter navigates to a match", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta alpha",
      plugins: [createSearchPlugin()]
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    }

    const input = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-input"]');
    expect(input).not.toBeNull();
    input!.value = "beta";
    input!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(container.querySelector(`.${SEARCH_ACTIVE_MATCH_CLASS}`)?.textContent).toBe("beta");

    editor.destroy();
    container.remove();
  });

  it("keeps existing Enter navigation when search history is disabled", () => {
    const harness = setupSearchPanel({ history: false } as Parameters<typeof createSearchPlugin>[0]);

    submitSearch(harness.input, "beta");

    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(harness.container.querySelector(`.${SEARCH_ACTIVE_MATCH_CLASS}`)?.textContent).toBe("beta");

    harness.destroy();
  });

  it("records submitted queries after trimming whitespace", () => {
    const storage = createMemoryHistoryStorage();
    const harness = setupSearchPanel(historyOptions({ storage }));

    submitSearch(harness.input, "  alpha  ");

    expect(storage.readHistory()).toEqual(["alpha"]);

    harness.destroy();
  });

  it("does not record blank submitted queries", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify(["alpha"]));
    const harness = setupSearchPanel(historyOptions({ storage }));

    submitSearch(harness.input, "   ");

    expect(storage.readRaw()).toBe(JSON.stringify(["alpha"]));
    expect(storage.setItem).not.toHaveBeenCalled();

    harness.destroy();
  });

  it("deduplicates repeated queries and moves the newest submission to the front", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify(["beta", "alpha"]));
    const harness = setupSearchPanel(historyOptions({ storage }));

    submitSearch(harness.input, "alpha");

    expect(storage.readHistory()).toEqual(["alpha", "beta"]);

    harness.destroy();
  });

  it("drops the oldest query when maxEntries is exceeded", () => {
    const storage = createMemoryHistoryStorage();
    const harness = setupSearchPanel(historyOptions({ storage, maxEntries: 2 }));

    submitSearch(harness.input, "alpha");
    submitSearch(harness.input, "beta");
    submitSearch(harness.input, "gamma");

    expect(storage.readHistory()).toEqual(["gamma", "beta"]);

    harness.destroy();
  });

  it("ignores invalid stored JSON and continues writing new history", () => {
    const storage = createMemoryHistoryStorage("not json");
    const harness = setupSearchPanel(historyOptions({ storage }));

    expect(() => submitSearch(harness.input, "alpha")).not.toThrow();
    expect(storage.readRaw()).toBe(JSON.stringify(["alpha"]));

    harness.destroy();
  });

  it("does not crash when history storage getItem throws", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("read failed");
      }),
      setItem: vi.fn()
    };
    const harness = setupSearchPanel(historyOptions({ storage }));

    expect(() => pressInputArrow(harness.input, "ArrowUp")).not.toThrow();
    expect(storage.getItem).toHaveBeenCalledWith(HISTORY_KEY);
    expect(() => submitSearch(harness.input, "beta")).not.toThrow();
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(harness.container.querySelector(`.${SEARCH_ACTIVE_MATCH_CLASS}`)?.textContent).toBe("beta");

    harness.destroy();
  });

  it("does not crash when history storage setItem throws", () => {
    const storage = {
      getItem: vi.fn(() => "[]"),
      setItem: vi.fn(() => {
        throw new Error("write failed");
      })
    };
    const harness = setupSearchPanel(historyOptions({ storage }));

    expect(() => submitSearch(harness.input, "beta")).not.toThrow();
    expect(storage.setItem).toHaveBeenCalled();
    expect(harness.editor.getSelection()).toEqual({ anchor: 0, head: 0 });
    expect(harness.container.querySelector(`.${SEARCH_ACTIVE_MATCH_CLASS}`)?.textContent).toBe("beta");

    harness.destroy();
  });

  it("recalls search history with ArrowUp and ArrowDown in the search input", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify(["gamma", "beta", "alpha"]));
    const harness = setupSearchPanel(historyOptions({ storage }));

    pressInputArrow(harness.input, "ArrowUp");
    expect(harness.input.value).toBe("gamma");

    pressInputArrow(harness.input, "ArrowUp");
    expect(harness.input.value).toBe("beta");

    pressInputArrow(harness.input, "ArrowDown");
    expect(harness.input.value).toBe("gamma");

    harness.destroy();
  });

  it("does not swallow ArrowUp or ArrowDown when search history is empty", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify([]));
    const harness = setupSearchPanel(historyOptions({ storage }));

    const up = pressInputArrow(harness.input, "ArrowUp");
    const down = pressInputArrow(harness.input, "ArrowDown");

    expect(up.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);

    harness.destroy();
  });

  it("does not swallow ArrowUp or ArrowDown when search history is disabled", () => {
    const harness = setupSearchPanel({ history: false } as Parameters<typeof createSearchPlugin>[0]);

    const up = pressInputArrow(harness.input, "ArrowUp");
    const down = pressInputArrow(harness.input, "ArrowDown");

    expect(up.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);

    harness.destroy();
  });

  it("recalls history without changing the replacement text", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify(["alpha"]));
    const harness = setupSearchPanel(historyOptions({ storage }));
    const replaceInput = harness.container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-replace-input"]'
    );
    expect(replaceInput).not.toBeNull();

    replaceInput!.value = "replacement";
    replaceInput!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    harness.input.value = "draft";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    pressInputArrow(harness.input, "ArrowUp");

    expect(harness.input.value).toBe("alpha");
    expect(replaceInput!.value).toBe("replacement");

    harness.destroy();
  });

  it("falls back to default button labels when localized labels are blank", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta alpha",
      plugins: [
        createSearchPlugin({
          labels: {
            replaceNext: "",
            replaceAll: " "
          }
        })
      ]
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    }

    const replaceButton = container.querySelector<HTMLButtonElement>('[data-test-id="markdown-search-replace"]');
    const replaceAllButton = container.querySelector<HTMLButtonElement>('[data-test-id="markdown-search-replace-all"]');
    expect(replaceButton?.getAttribute("aria-label")).toBe("Replace");
    expect(replaceButton?.title).toBe("Replace");
    expect(replaceAllButton?.getAttribute("aria-label")).toBe("Replace all");
    expect(replaceAllButton?.title).toBe("Replace all");

    editor.destroy();
    container.remove();
  });
});
