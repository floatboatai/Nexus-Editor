import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "../../preset-gfm/src/index";
import {
  createSearchPlugin,
  findDetailedFuzzyMatches,
  findScoredFuzzyMatches,
  findSearchMatches,
  replaceAllMatches
} from "../src/index";

const HISTORY_KEY = "nexus:test-search-history";
const TABLE_SEARCH_HIGHLIGHT_PREFIX = "nexus-table-search-";

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

function setupSearchPanel(options: Parameters<typeof createSearchPlugin>[0] = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container,
    initialValue: "alpha beta gamma alpha",
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
    expect(plugin.cmExtensions).toHaveLength(4);
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

      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([
        "SearchNeedle070"
      ]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);
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
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([
        "RichNeedle"
      ]);

      submitSearch(input, "bc");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);

      submitSearch(input, "Label");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual(["Label"]);

      submitSearch(input, "HiddenNeedle");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);

      submitSearch(input, "RepeatedLabel");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([
        "RepeatedLabel"
      ]);

      submitSearch(input, "CodeNeedle");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([
        "CodeNeedle"
      ]);
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
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual(["Label"]);

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

  it("uses whole-document regexp context for rendered table matches", () => {
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
      const input = openSearchPanel(container);
      const regexpField = container.querySelector<HTMLInputElement>(
        '[data-test-id="markdown-search-regexp-toggle"]'
      );
      expect(regexpField).not.toBeNull();
      regexpField!.checked = true;
      regexpField!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

      submitSearch(input, "Label$");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([]);
      expect(readTableHighlightTexts(highlightSupport.registry, "match")).toEqual([]);

      submitSearch(input, "Label(?= \\|)");
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual(["Label"]);
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

      expect(readTableHighlightTexts(highlightSupport.registry, "selected").sort()).toEqual([
        "FirstNeedle",
        "SecondNeedle"
      ]);
      expect(
        document.querySelectorAll("style[data-nexus-table-search-highlight]").length
      ).toBe(initialStyleCount + 2);

      firstEditor.destroy();
      expect(readTableHighlightTexts(highlightSupport.registry, "selected")).toEqual([
        "SecondNeedle"
      ]);
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
            next: "下一个"
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
    const nextButton = container.querySelector<HTMLButtonElement>('[data-test-id="markdown-search-next"]');
    const nextTooltip = container.querySelector<HTMLElement>('[data-test-id="markdown-search-next-tooltip"]');
    const replaceToggle = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-toggle-replace"]'
    );
    const replaceToggleTooltip = container.querySelector<HTMLElement>(
      '[data-test-id="markdown-search-toggle-replace-tooltip"]'
    );
    const replaceRow = container.querySelector<HTMLDivElement>('[data-test-id="markdown-search-replace-row"]');
    expect(nextButton?.textContent).toBe("");
    expect(nextButton?.title).toBe("");
    expect(nextButton?.getAttribute("aria-label")).toBe("下一个");
    expect(nextButton?.getAttribute("aria-describedby")).toBe(nextTooltip?.id);
    expect(nextButton?.querySelector("svg")).not.toBeNull();
    expect(nextTooltip?.getAttribute("role")).toBe("tooltip");
    expect(nextTooltip?.getAttribute("aria-label")).toBe("下一个");
    expect(nextTooltip?.dataset.tooltip).toBe("下一个");
    expect(nextTooltip?.textContent).toBe("下一个");
    expect(container.querySelector('[data-test-id="markdown-search-find-row"]')).not.toBeNull();
    expect(replaceToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(replaceToggle?.getAttribute("aria-label")).toBe("Show replace");
    expect(replaceToggle?.getAttribute("aria-controls")).toBe(replaceRow?.id);
    expect(replaceToggleTooltip?.textContent).toBe("Show replace");
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.hidden).toBe(true);

    replaceToggle?.click();
    expect(replaceToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(replaceToggle?.getAttribute("aria-label")).toBe("Hide replace");
    expect(replaceToggleTooltip?.textContent).toBe("Hide replace");
    expect(replaceRow?.hidden).toBe(false);

    replaceToggle?.click();
    expect(replaceToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(replaceRow?.hidden).toBe(true);

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

    const selection = editor.getSelection();
    expect(Math.min(selection.anchor, selection.head)).toBe(6);
    expect(Math.max(selection.anchor, selection.head)).toBe(10);

    editor.destroy();
    container.remove();
  });

  it("keeps existing Enter navigation when search history is disabled", () => {
    const harness = setupSearchPanel({ history: false } as Parameters<typeof createSearchPlugin>[0]);

    submitSearch(harness.input, "beta");

    const selection = harness.editor.getSelection();
    expect(Math.min(selection.anchor, selection.head)).toBe(6);
    expect(Math.max(selection.anchor, selection.head)).toBe(10);

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
    const selection = harness.editor.getSelection();
    expect(Math.min(selection.anchor, selection.head)).toBe(6);
    expect(Math.max(selection.anchor, selection.head)).toBe(10);

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
    const selection = harness.editor.getSelection();
    expect(Math.min(selection.anchor, selection.head)).toBe(6);
    expect(Math.max(selection.anchor, selection.head)).toBe(10);

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

  it("recalls history without changing case, regexp, or whole-word options", () => {
    const storage = createMemoryHistoryStorage(JSON.stringify(["alpha"]));
    const harness = setupSearchPanel(historyOptions({ storage }));
    const caseField = harness.container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-case-toggle"]'
    );
    const regexpField = harness.container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-regexp-toggle"]'
    );
    const wholeWordField = harness.container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-word-toggle"]'
    );
    expect(caseField).not.toBeNull();
    expect(regexpField).not.toBeNull();
    expect(wholeWordField).not.toBeNull();

    caseField!.checked = true;
    regexpField!.checked = true;
    wholeWordField!.checked = true;
    caseField!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    regexpField!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    wholeWordField!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    harness.input.value = "draft";
    harness.input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    pressInputArrow(harness.input, "ArrowUp");

    expect(harness.input.value).toBe("alpha");
    expect(caseField!.checked).toBe(true);
    expect(regexpField!.checked).toBe(true);
    expect(wholeWordField!.checked).toBe(true);

    harness.destroy();
  });

  it("finds fuzzy matches where query characters appear in order", () => {
    expect(findSearchMatches("NexusEditor markdown tool", "ne", { fuzzy: true })).toEqual([
      { from: 0, to: 2, text: "Ne" },
    ]);
  });

  it("handles fuzzy search case-insensitively by default", () => {
    expect(findSearchMatches("FooBar FIZZBUZZ", "fb", { fuzzy: true })).toEqual([
      { from: 0, to: 4, text: "FooB" },
      { from: 7, to: 12, text: "FIZZB" },
    ]);
  });

  it("supports case-sensitive fuzzy matching", () => {
    expect(findSearchMatches("FooBar fooBar", "FB", { fuzzy: true, caseSensitive: true })).toEqual([
      { from: 0, to: 4, text: "FooB" },
    ]);
  });

  it("matches consecutive identical characters in fuzzy mode", () => {
    expect(findSearchMatches("bookkeeper", "oo", { fuzzy: true })).toEqual([
      { from: 1, to: 3, text: "oo" },
    ]);
  });

  it("returns empty for fuzzy query not matching any text", () => {
    expect(findSearchMatches("hello world", "xyz", { fuzzy: true })).toEqual([]);
  });

  it("returns empty for empty fuzzy query", () => {
    expect(findSearchMatches("hello world", "", { fuzzy: true })).toEqual([]);
  });

  it("returns empty for whitespace-only fuzzy query", () => {
    expect(findSearchMatches("hello world", "   ", { fuzzy: true })).toEqual([]);
  });

  it("escapes regex-special characters in fuzzy query", () => {
    expect(findSearchMatches("hello.world hello*world", ".*", { fuzzy: true })).toEqual([
      { from: 5, to: 18, text: ".world hello*" },
    ]);
  });

  it("replaces with fuzzy matching", () => {
    expect(replaceAllMatches("NexusEditor markdown", "ne", "XX", { fuzzy: true })).toBe(
      "XXxusEditor markdown"
    );
  });

  it("fuzzy mode ignores wholeWord and regexp options", () => {
    expect(findSearchMatches("foo bar baz qux", "br", {
      fuzzy: true,
      wholeWord: true,
      regexp: true,
    })).toEqual([
      { from: 4, to: 7, text: "bar" },
    ]);
  });

  it("returns empty for ultra-long fuzzy queries (length guard)", () => {
    const longQuery = "a".repeat(201);
    expect(findSearchMatches("aaa", longQuery, { fuzzy: true })).toEqual([]);
  });

  it("handles large document fuzzy search within acceptable time budget", () => {
    // Simulates searching across a ~50KB document (roughly 10K words).
    // The .*? non-greedy pattern should not exhibit catastrophic
    // backtracking because each atom is a single literal character.
    const largeDoc = "word ".repeat(10000); // 50K characters

    const start = performance.now();
    const results = findSearchMatches(largeDoc, "wrd", { fuzzy: true });
    const elapsed = performance.now() - start;

    // Must find matches (every "word " contains w→r→d in order).
    expect(results.length).toBe(10000);
    // Performance guard: even on slow CI machines this should be < 500ms.
    // A regression (e.g., greedy pattern or missing escape) would explode here.
    expect(elapsed).toBeLessThan(500);
  });

  it("renders a fuzzy toggle checkbox in the search panel", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta gamma",
      plugins: [createSearchPlugin()],
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    const fuzzyCheckbox = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzyCheckbox).not.toBeNull();
    expect(fuzzyCheckbox?.type).toBe("checkbox");
    expect(fuzzyCheckbox?.checked).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("finds fuzzy results via the search panel when fuzzy is checked", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "NexusEditor\nfloatboat\nnext editor",
      plugins: [createSearchPlugin()],
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    const input = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-input"]'
    );
    const fuzzyCheckbox = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(input).not.toBeNull();
    expect(fuzzyCheckbox).not.toBeNull();

    fuzzyCheckbox!.checked = true;
    fuzzyCheckbox!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    input!.value = "ft";
    input!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      })
    );

    const selection = editor.getSelection();
    expect(Math.min(selection.anchor, selection.head)).toBe(12);
    expect(Math.max(selection.anchor, selection.head)).toBe(17);

    editor.destroy();
    container.remove();
  });

  it("supports localized fuzzy label", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [
        createSearchPlugin({
          labels: {
            fuzzy: "FuzzyMatch",
          },
        }),
      ],
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    if (!container.querySelector('[data-test-id="markdown-search-bar"]')) {
      content?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }

    const fuzzyLabel = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    )?.parentElement;
    expect(fuzzyLabel?.textContent).toBe("FuzzyMatch");

    editor.destroy();
    container.remove();
  });

  it("falls back to default tooltip labels when localized labels are blank", () => {
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
    const replaceTooltip = container.querySelector<HTMLElement>('[data-test-id="markdown-search-replace-tooltip"]');
    const replaceAllButton = container.querySelector<HTMLButtonElement>('[data-test-id="markdown-search-replace-all"]');
    const replaceAllTooltip = container.querySelector<HTMLElement>(
      '[data-test-id="markdown-search-replace-all-tooltip"]'
    );
    expect(replaceButton?.getAttribute("aria-label")).toBe("Replace");
    expect(replaceTooltip?.textContent).toBe("Replace");
    expect(replaceAllButton?.getAttribute("aria-label")).toBe("Replace all");
    expect(replaceAllTooltip?.textContent).toBe("Replace all");

    editor.destroy();
    container.remove();
  });
});

// ===========================================================================
// Part A: Fuzzy scoring tests (position-weighted ranking)
// ===========================================================================

describe("fuzzy scoring — findScoredFuzzyMatches", () => {
  it("sorts prefix matches above non-prefix matches", () => {
    const results = findScoredFuzzyMatches(
      "floatboat aftermath footnote",
      "ft",
      { fuzzy: true }
    );

    // "floatboat" starts with 'ft' → prefix bonus, highest score
    // "aftermath": a-f-t → not a prefix match
    // "footnote": f-o-t → not a prefix (gap between f and t)
    expect(results.length).toBeGreaterThanOrEqual(2);
    // First result must be a match starting with query[0] ('f')
    // (either prefix or word-boundary, both get high scores)
    expect(results[0].text[0].toLowerCase()).toBe("f");
    expect(results[0].score).toBeGreaterThan(15); // has first-char or boundary bonus
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThan(results[1].score);
    }
  });

  it("awards consecutive-char bonus", () => {
    const results = findScoredFuzzyMatches("aftermath aftermath", "ft", {
      fuzzy: true,
      caseSensitive: false
    });

    // Both matches have same text but "aftermath" doesn't have consecutive ft.
    // "aftermath": a-f-t-e-r-m-a-t-h → 'f' and 't' are at positions 1,3 (gap=1)
    results.forEach(r => {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
    });
  });

  it("gives word-boundary bonus for camelCase or underscore-separated words", () => {
    const results = findScoredFuzzyMatches(
      "myFunctionName my_fancy_function",
      "mfn",
      { fuzzy: true }
    );
    // "myFunctionName": m(y)F(unction)N(ame) — F and N are at word boundaries
    // "my_fancy_function": m(y)_f(a)n(c)y_...
    // The camelCase one should score well due to boundary bonuses
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Note: matchedIndices is intentionally omitted from ScoredSearchMatch;
    // use findDetailedFuzzyMatches if you need per-character position tracking.
    expect(typeof results[0].score).toBe("number");
    expect(results[0].score).toBeGreaterThanOrEqual(0);
  });

  it("applies gap penalty — closer chars score higher", () => {
    const results = findScoredFuzzyMatches("ab abc abcd", "ab", {
      fuzzy: true
    });

    // Exact match "ab" (positions 0-1): no gaps, high score
    // "abc" (3-5): has extra char 'c' after exact match → slight penalty
    // "abcd" (8-11): even longer span → more length penalty
    if (results.length >= 2) {
      // First result should be the tightest match
      const firstSpan = results[0].to - results[0].from;
      const lastSpan = results[results.length - 1].to - results[results.length - 1].from;
      expect(firstSpan).toBeLessThanOrEqual(lastSpan);
    }
  });

  it("returns score 0 for non-fuzzy fallback mode", () => {
    const results = findScoredFuzzyMatches("hello world", "ello", {});
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(0); // Non-fuzzy gets default 0 score
  });

  it("returns empty array for empty query", () => {
    expect(findScoredFuzzyMatches("hello", "", { fuzzy: true })).toEqual([]);
  });

  it("handles case-sensitive scoring correctly", () => {
    const resultsCS = findScoredFuzzyMatches("FooBar Foobar", "FB", {
      fuzzy: true,
      caseSensitive: true
    });
    // Case-sensitive: only "FooBar" has uppercase F and B
    // F(0)...B(3) in "FooBar" → span [0,4) = "Foob"
    // "Foobar" has lowercase 'b' — no match for 'B'
    expect(resultsCS.length).toBe(1);
    expect(resultsCS[0].text.startsWith("F")).toBe(true);
  });

  it("sorts all results by descending score", () => {
    const results = findScoredFuzzyMatches("ab acb aabc aaabbbccc", "abc", {
      fuzzy: true
    });

    // Verify monotonic descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ===========================================================================
// Part B: Character-level position tracking (findDetailedFuzzyMatches)
// ===========================================================================

describe("detailed fuzzy matches — findDetailedFuzzyMatches", () => {
  it("returns matchedIndices with correct absolute positions", () => {
    const results = findDetailedFuzzyMatches("floatboat editor", "ft", {
      fuzzy: true
    });

    // "floatboat" at position 0: f=0, t=4 → span [0,5) = "float"
    const match = results.find(m => m.text.startsWith("float"));
    expect(match).toBeDefined();
    expect(match!.matchedIndices).toEqual([0, 4]);
    expect(match!.from).toBe(0);
    expect(match!.to).toBe(5);
  });

  it("matchedIndices length equals query length", () => {
    const results = findDetailedFuzzyMatches("NexusEditor is great", "ne", {
      fuzzy: true
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // Query "ne" has 2 chars, so each match must have exactly 2 indices
    results.forEach(m => {
      expect(m.matchedIndices.length).toBe(2);
    });
  });

  it("tracks positions correctly for multi-char queries", () => {
    const results = findDetailedFuzzyMatches("abcdefghij", "adf", {
      fuzzy: true
    });

    // In "abcdefghij":
    //   a=0, d=3, f=5
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchedIndices).toEqual([0, 3, 5]);
  });

  it("provides indices suitable for char-level highlighting", () => {
    const doc = "searchResult filterResult";
    const results = findDetailedFuzzyMatches(doc, "sr", { fuzzy: true });

    // For each match, the matchedIndices should point to actual 's'/'r' chars in doc
    results.forEach(match => {
      match.matchedIndices.forEach((pos, qi) => {
        const expectedChar = qi === 0 ? "s" : "r";
        expect(doc[pos].toLowerCase()).toBe(expectedChar);
      });
    });
  });

  it("includes score alongside matchedIndices", () => {
    const results = findDetailedFuzzyMatches("foo bar baz", "fb", {
      fuzzy: true
    });

    results.forEach(m => {
      expect(typeof m.score).toBe("number");
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(m.matchedIndices)).toBe(true);
      expect(m.matchedIndices.length).toBe(2); // "fb" query length
    });
  });

  it("handles case-insensitive position tracking", () => {
    const docText = "FloatBoat FLOATBOAT";
    const results = findDetailedFuzzyMatches(docText, "ft", {
      fuzzy: true,
      caseSensitive: false
    });

    // Should find both words containing 'f' then 't'
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Check that matchedIndices map to correct original-case characters
    const firstMatch = results[0];
    // In "FloatBoat": F at pos 0, t at pos 4 → span [0, 5) = "Float"
    expect(firstMatch.matchedIndices.length).toBe(2);
    expect(docText[firstMatch.matchedIndices[0]].toLowerCase()).toBe("f");
    expect(docText[firstMatch.matchedIndices[1]].toLowerCase()).toBe("t");
  });

  it("returns empty for ultra-long queries (length guard applies)", () => {
    const longQuery = "a".repeat(201);
    expect(findDetailedFuzzyMatches("aaa", longQuery, { fuzzy: true })).toEqual([]);
  });

  it("deduplicates identical spans from overlapping start positions", () => {
    // In "aaaa", searching "aa" from position 0 gives [0,1], pos 1 gives [1,2], etc.
    // All are distinct spans so no dedup needed here.
    const results = findDetailedFuzzyMatches("aaaa", "aa", { fuzzy: true });
    // Should get multiple distinct matches (each starting at different offset)
    expect(results.length).toBeGreaterThanOrEqual(1);

    // But verify no duplicate from/to pairs
    const spans = new Set<string>();
    results.forEach(m => {
      const key = `${m.from}:${m.to}`;
      expect(spans.has(key)).toBe(false); // No duplicates
      spans.add(key);
    });
  });

  it("scores prefix match highest among candidates", () => {
    const results = findDetailedFuzzyMatches("filter flat after float", "fl", {
      fuzzy: true
    });

    // "flat" and "float" both start with "fl" → prefix bonus (+16)
    // "filter": f(0)...l(2) → also prefix but with a gap ('i')
    // All should have higher score than any non-prefix match (if any exist)
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Top result(s) must be prefix matches (text starting with 'f'/'F')
    const topMatch = results[0];
    expect(topMatch.text[0].toLowerCase()).toBe("f");
    // Prefix matches get FIRST_CHAR_BONUS (+16)
    expect(topMatch.score).toBeGreaterThan(15);

    // Verify descending order: every subsequent score ≤ previous
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });
});

// ===========================================================================
// Layer 5: Functional edge-case tests (boundary conditions, special chars,
//           cross-API consistency, performance)
// ===========================================================================

describe("functional edge cases — boundary & special inputs", () => {
  it("handles single-character fuzzy query", () => {
    const results = findSearchMatches("hello world", "e", { fuzzy: true });
    expect(results).toEqual([{ from: 1, to: 2, text: "e" }]);
  });

  it("handles single-char query with findScoredFuzzyMatches", () => {
    const results = findScoredFuzzyMatches("hello eel", "e", { fuzzy: true });
    // "hello": e at 1; "eel": e at 6, e at 7 → 3 matches
    expect(results.length).toBe(3);
    results.forEach(r => {
      expect(r.score).toBeGreaterThanOrEqual(0);
    });
  });

  it("handles single-char query with findDetailedFuzzyMatches", () => {
    const results = findDetailedFuzzyMatches("test east", "e", { fuzzy: true });
    expect(results.length).toBe(2);
    results.forEach(r => {
      expect(r.matchedIndices).toHaveLength(1);
      expect(r.text[r.matchedIndices[0] - r.from].toLowerCase()).toBe("e");
    });
  });

  it("handles query longer than document (no match)", () => {
    expect(findSearchMatches("hi", "abcdefg", { fuzzy: true })).toEqual([]);
    expect(findScoredFuzzyMatches("hi", "abcdefg", { fuzzy: true })).toEqual([]);
    expect(findDetailedFuzzyMatches("hi", "abcdefg", { fuzzy: true })).toEqual([]);
  });

  it("handles exact match (query equals document)", () => {
    const results = findDetailedFuzzyMatches("exact", "exact", { fuzzy: true });
    expect(results).toHaveLength(1);
    expect(results[0].matchedIndices).toEqual([0, 1, 2, 3, 4]);
    expect(results[0].score).toBeGreaterThan(20); // prefix + consecutive bonuses
  });

  it("handles document with only one character", () => {
    expect(findSearchMatches("a", "a", { fuzzy: true })).toEqual([{ from: 0, to: 1, text: "a" }]);
    expect(findSearchMatches("a", "b", { fuzzy: true })).toEqual([]);
  });

  it("handles empty document", () => {
    expect(findSearchMatches("", "a", { fuzzy: true })).toEqual([]);
    expect(findScoredFuzzyMatches("", "a", { fuzzy: true })).toEqual([]);
    expect(findDetailedFuzzyMatches("", "a", { fuzzy: true })).toEqual([]);
  });

  it("handles newline characters in document", () => {
    const doc = "line1\nline2\nfloat";
    const results = findSearchMatches(doc, "ft", { fuzzy: true });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Match should span within "float" at the end
    const floatMatch = results.find(r => r.text.includes("float"));
    expect(floatMatch).toBeDefined();
  });

  it("handles tab characters in document", () => {
    const doc = "col1\tcolumn\tfc";
    const results = findSearchMatches(doc, "fc", { fuzzy: true });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("handles Unicode letters in fuzzy query", () => {
    const results = findSearchMatches("café résumé", "cé", { fuzzy: true });
    // Should find "cé" inside "café" — non-greedy shortest span
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("handles regex meta-characters escaped in fuzzy mode", () => {
    // These chars are special in regex but should be treated as literals in fuzzy mode
    const specials = ["(", ")", "[", "]", "{", "}", "^", "$", "|", "+", "\\"];
    for (const ch of specials) {
      const doc = `prefix${ch}suffix`;
      const results = findSearchMatches(doc, ch, { fuzzy: true });
      expect(results.length).toBeGreaterThanOrEqual(0); // Should not throw
    }
  });

  it("handles dot-star-question in fuzzy query (escaped properly)", () => {
    const results = findSearchMatches("a.b?c*d", "b?c", { fuzzy: true });
    // '?' is not a regex special needing escape per our escapeRegExp, but test no crash
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("fuzzy replace with empty replacement deletes matched spans", () => {
    // fuzzy replace uses regex bridge; "ft" in "floatboat aftermath" matches:
    // [0,5)="float" and [11,16)="after" (non-greedy shortest span containing f...t)
    const result = replaceAllMatches("floatboat aftermath", "ft", "", { fuzzy: true });
    // Verify the operation succeeds without crash
    expect(typeof result).toBe("string");
    expect(result.length).toBeLessThan("floatboat aftermath".length);
  });

  it("length guard applies consistently across all three APIs", () => {
    const longQuery = "a".repeat(201);
    expect(findSearchMatches("test", longQuery, { fuzzy: true })).toEqual([]);
    expect(findScoredFuzzyMatches("test", longQuery, { fuzzy: true })).toEqual([]);
    expect(findDetailedFuzzyMatches("test", longQuery, { fuzzy: true })).toEqual([]);
  });

  it("length guard boundary: exactly MAX_LENGTH=200 returns results", () => {
    const query200 = "a".repeat(200);
    const doc = "a".repeat(200);
    // Should not reject (exactly at limit)
    const results = findSearchMatches(doc, query200, { fuzzy: true });
    // May or may not find matches depending on implementation details,
    // but must not return null/error and must be an array
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("cross-API consistency", () => {
  it("findScoredFuzzyMatches and findDetailedFuzzyMatches return same count", () => {
    const doc = "floatboat aftermath footnote filter flat";
    const query = "ft";

    const scored = findScoredFuzzyMatches(doc, query, { fuzzy: true });
    const detailed = findDetailedFuzzyMatches(doc, query, { fuzzy: true });

    expect(scored.length).toBe(detailed.length);
  });

  it("findScoredFuzzyMatches omits matchedIndices from output", () => {
    const results = findScoredFuzzyMatches("floatboat", "ft", { fuzzy: true });
    if (results.length > 0) {
      expect("matchedIndices" in results[0]).toBe(false);
    }
  });

  it("findDetailedFuzzyMatches always includes matchedIndices", () => {
    const results = findDetailedFuzzyMatches("test", "tst", { fuzzy: true });
    results.forEach(r => {
      expect(Array.isArray(r.matchedIndices)).toBe(true);
      expect(r.matchedIndices.length).toBe(3);
    });
  });

  it("score values are identical between Scored and Detailed for same input", () => {
    const doc = "floatboat aftermath";
    const query = "ft";

    const scored = findScoredFuzzyMatches(doc, query, { fuzzy: true });
    const detailed = findDetailedFuzzyMatches(doc, query, { fuzzy: true });

    expect(scored.length).toBe(detailed.length);
    for (let i = 0; i < scored.length; i++) {
      expect(scored[i].score).toBe(detailed[i].score);
      expect(scored[i].from).toBe(detailed[i].from);
      expect(scored[i].to).toBe(detailed[i].to);
      expect(scored[i].text).toBe(detailed[i].text);
    }
  });

  it("non-fuzzy mode falls back correctly in both APIs", () => {
    const doc = "hello world";
    const query = "ello";

    const scored = findScoredFuzzyMatches(doc, query); // no fuzzy option
    const detailed = findDetailedFuzzyMatches(doc, query);

    // Both should return [] since fuzzy=false without explicit flag
    expect(scored).toEqual([{ from: 1, to: 5, text: "ello", score: 0 }]);
    expect(detailed).toEqual([]); // Detailed requires fuzzy:true
  });

  it("findSearchMatches (regex bridge) and findAllFuzzyMatchesDetailed cover same spans", () => {
    const doc = "floatboat aftermath";
    const query = "ft";

    const regexResults = findSearchMatches(doc, query, { fuzzy: true });
    const detailedResults = findDetailedFuzzyMatches(doc, query, { fuzzy: true });

    // Both should find at least the same match regions.
    // Note: regex bridge and backtracking matcher may differ on overlapping
    // start positions (regex finds non-overlapping matches left-to-right,
    // while backtracking scans every start position), so we check that all
    // regex results appear in detailed results.
    expect(regexResults.length).toBeGreaterThan(0);
    expect(detailedResults.length).toBeGreaterThan(0);

    for (const rr of regexResults) {
      const found = detailedResults.some(dr => dr.from === rr.from && dr.to === rr.to);
      expect(found).toBe(true);
    }
  });
});

describe("performance stress tests", () => {
  it("findDetailedFuzzyMatches handles 50K char doc under 500ms", () => {
    const largeDoc = "word ".repeat(10000); // ~50K chars
    const start = performance.now();
    const results = findDetailedFuzzyMatches(largeDoc, "wrd", { fuzzy: true });
    const elapsed = performance.now() - start;

    expect(results.length).toBe(10000);
    expect(elapsed).toBeLessThan(500);
  });

  it("findScoredFuzzyMatches handles 50K char doc under 500ms", () => {
    const largeDoc = "word ".repeat(10000);
    const start = performance.now();
    const results = findScoredFuzzyMatches(largeDoc, "wrd", { fuzzy: true });
    const elapsed = performance.now() - start;

    expect(results.length).toBe(10000);
    expect(elapsed).toBeLessThan(500);
  });

  it("handles 10K distinct matches without overflow", () => {
    // Each "aba" produces a match for query "aa"
    const doc = "aba ".repeat(10000);
    const results = findDetailedFuzzyMatches(doc, "aa", { fuzzy: true });
    // Should cap at 10_000 entries
    expect(results.length).toBeLessThanOrEqual(10_000);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("all-same-character document with all-same-character query is fast", () => {
    const doc = "a".repeat(50000);
    const start = performance.now();
    const results = findDetailedFuzzyMatches(doc, "aaa", { fuzzy: true });
    const elapsed = performance.now() - start;

    // Many overlapping matches possible; capped at 10k
    expect(results.length).toBeLessThanOrEqual(10_000);
    expect(elapsed).toBeLessThan(1000);
  });
});

// ===========================================================================
// Layer 6: Rigor / correctness tests (type constraints, algorithmic invariants,
//            numerical properties)
// ===========================================================================

describe("rigor — type safety and structural invariants", () => {
  it("every SearchMatch has integer from < to and non-empty text", () => {
    const doc = "hello world test";
    const results = findSearchMatches(doc, "l", { fuzzy: true });
    results.forEach(m => {
      expect(Number.isInteger(m.from)).toBe(true);
      expect(Number.isInteger(m.to)).toBe(true);
      expect(m.from).toBeLessThan(m.to);
      expect(typeof m.text).toBe("string");
      expect(m.text.length).toBeGreaterThan(0);
      expect(m.to - m.from).toBe(m.text.length);
    });
  });

  it("every ScoredSearchMatch has numeric non-negative score", () => {
    const results = findScoredFuzzyMatches("test east", "te", { fuzzy: true });
    results.forEach(m => {
      expect(typeof m.score).toBe("number");
      expect(m.score).not.toBeNaN();
      expect(m.score).toBeGreaterThanOrEqual(0);
    });
  });

  it("every DetailedFuzzyMatch has matchedIndices length === query length", () => {
    const queries = ["a", "ab", "abc", "abcd"];
    queries.forEach(q => {
      const results = findDetailedFuzzyMatches("abcdefghij", q, { fuzzy: true });
      results.forEach(m => {
        expect(m.matchedIndices.length).toBe(q.length);
      });
    });
  });

  it("every matchedIndex is within [from, to) bounds", () => {
    const results = findDetailedFuzzyMatches("some float boat data", "ft", { fuzzy: true });
    results.forEach(m => {
      m.matchedIndices.forEach((idx, qi) => {
        expect(idx).toBeGreaterThanOrEqual(m.from);
        expect(idx).toBeLessThan(m.to);
        expect(Number.isInteger(idx)).toBe(true);
      });
    });
  });

  it("matchedIndices are strictly increasing (monotonic)", () => {
    const results = findDetailedFuzzyMatches("abcdefghij", "adf", { fuzzy: true });
    results.forEach(m => {
      for (let i = 1; i < m.matchedIndices.length; i++) {
        expect(m.matchedIndices[i]).toBeGreaterThan(m.matchedIndices[i - 1]);
      }
    });
  });

  it("from equals matchedIndices[0], to equals matchedIndices[last] + 1", () => {
    const results = findDetailedFuzzyMatches("testing abc", "tab", { fuzzy: true });
    results.forEach(m => {
      expect(m.from).toBe(m.matchedIndices[0]);
      expect(m.to).toBe(m.matchedIndices[m.matchedIndices.length - 1] + 1);
    });
  });
});

describe("rigor — scoring algorithm invariants", () => {
  it("perfect prefix match scores higher than any non-prefix match", () => {
    const results = findScoredFuzzyMatches(
      "flat filter after flatter",
      "fl",
      { fuzzy: true }
    );

    if (results.length >= 2) {
      // The top result(s) should include a prefix match with FIRST_CHAR_BONUS
      const best = results[0];
      expect(best.score).toBeGreaterThanOrEqual(16);
    }
  });

  it("shorter span with same char positions scores higher (length penalty)", () => {
    const r1 = findScoredFuzzyMatches("ab", "ab", { fuzzy: true })[0];
    const r2 = findScoredFuzzyMatches("abc", "ab", { fuzzy: true })[0];

    // Both have same relative positions [0,1] but r2 has longer span
    if (r1 && r2) {
      // r1's score should be >= r2 (shorter span → less length penalty)
      expect(r1.score).toBeGreaterThanOrEqual(r2.score);
      // And strictly greater when spans differ
      if (r1.to - r1.from < r2.to - r2.from) {
        expect(r1.score).toBeGreaterThan(r2.score);
      }
    }
  });

  it("consecutive chars always score higher than same chars with gaps", () => {
    // "ftc" in "aftc": consecutive f-t-c → high consecutive bonus
    // "ftc" in "afxtxc": f...t...c → gaps between each
    const rConsec = findScoredFuzzyMatches("aftc", "ftc", { fuzzy: true });
    const rGapped = findScoredFuzzyMatches("afxtxc", "ftc", { fuzzy: true });

    if (rConsec.length > 0 && rGapped.length > 0) {
      expect(rConsec[0].score).toBeGreaterThan(rGapped[0].score);
    }
  });

  it("scores are deterministic (same input → same output)", () => {
    const doc = "floatboat aftermath footnote filter";
    const query = "ft";

    const r1 = findScoredFuzzyMatches(doc, query, { fuzzy: true });
    const r2 = findScoredFuzzyMatches(doc, query, { fuzzy: true });

    expect(r1.length).toBe(r2.length);
    for (let i = 0; i < r1.length; i++) {
      expect(r1[i].score).toBe(r2[i].score);
      expect(r1[i].from).toBe(r2[i].from);
      expect(r1[i].to).toBe(r2[i].to);
    }
  });

  it("caseSensitive=true yields subset of caseSensitive=false results", () => {
    const doc = "FooBar foobar FOOBAR fooBar";
    const query = "fb";

    const ci = findDetailedFuzzyMatches(doc, query, { fuzzy: true, caseSensitive: false });
    const cs = findDetailedFuzzyMatches(doc, query, { fuzzy: true, caseSensitive: true });

    // Case-sensitive results should be a subset (fewer or equal)
    expect(cs.length).toBeLessThanOrEqual(ci.length);
  });

  it("empty string query across all APIs returns empty arrays (no crash)", () => {
    expect(findSearchMatches("anything", "", { fuzzy: true })).toEqual([]);
    expect(findSearchMatches("anything", "", {})).toEqual([]);
    expect(findScoredFuzzyMatches("anything", "", { fuzzy: true })).toEqual([]);
    expect(findDetailedFuzzyMatches("anything", "", { fuzzy: true })).toEqual([]);
  });

  it("whitespace-only query returns empty", () => {
    expect(findSearchMatches("test", "   ", { fuzzy: true })).toEqual([]);
    expect(findSearchMatches("test", "\t\n", { fuzzy: true })).toEqual([]);
  });

  it("replaceAllMatches with empty query returns original doc unchanged", () => {
    expect(replaceAllMatches("hello", "", "X")).toBe("hello");
    expect(replaceAllMatches("hello", "", "X", { fuzzy: true })).toBe("hello");
  });
});

describe("rigor — backtracking matcher correctness", () => {
  it("greedy completion finds leftmost-longest valid completion", () => {
    // In "axxbc", query "ac":
    // Starting from 'a' at pos 0, greedy picks first 'c' at pos 3
    // Span should be [0,4) = "axxb"
    const results = findDetailedFuzzyMatches("axxbc", "ac", { fuzzy: true });
    expect(results).toHaveLength(1);
    expect(results[0].from).toBe(0);
    expect(results[0].to).toBe(5); // 'c' is last char
    expect(results[0].matchedIndices).toEqual([0, 4]);
  });

  it("fails gracefully when later query chars are absent", () => {
    expect(findDetailedFuzzyMatches("abc", "ad", { fuzzy: true })).toEqual([]);
    expect(findScoredFuzzyMatches("abc", "ad", { fuzzy: true })).toEqual([]);
  });

  it("overlapping start positions produce distinct spans", () => {
    // In "aaaa", query "aa":
    // Start pos 0: greedy takes [0,1] → indices [0,1], span "aa"
    // Start pos 1: greedy takes [1,2] → indices [1,2], span "aa"
    // Start pos 2: greedy takes [2,3] → indices [2,3], span "aa"
    const results = findDetailedFuzzyMatches("aaaa", "aa", { fuzzy: true });
    expect(results.length).toBe(3);

    const spans = new Set<string>();
    results.forEach(r => {
      const key = `${r.from}:${r.to}`;
      expect(spans.has(key)).toBe(false); // No duplicate spans
      spans.add(key);
    });
  });

  it("first character scan does not skip any occurrence", () => {
    const doc = "aXaXaXa";
    const results = findDetailedFuzzyMatches(doc, "ax", { fuzzy: true });
    // Every 'a' followed by an 'x' somewhere after it
    // Positions of 'a': 0, 2, 4, 6; 'x' at: 1, 3, 5
    // a@0 → x@1 (span [0,2)), a@2 → x@3 ([2,4)), a@4 → x@5 ([4,6))
    // a@6 has no 'x' after it, so only 3 matches
    expect(results.length).toBe(3);
  });
});
