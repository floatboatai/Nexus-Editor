import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "../../preset-gfm/src/index";
import {
  createSearchPlugin,
  findSearchMatches,
  fuzzyMatch,
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

  describe("fuzzy matching", () => {
    it("matches a subsequence and returns the matched positions", () => {
      expect(fuzzyMatch("hello", "hlo")).toEqual({ score: 37, positions: [0, 3, 4] });
    });

    it("preserves query order — out-of-order characters do not match", () => {
      expect(fuzzyMatch("abc", "cba")).toBeNull();
      expect(fuzzyMatch("acb", "abc")).toBeNull();
    });

    it("returns null when the query is not a subsequence", () => {
      expect(fuzzyMatch("abc", "abcd")).toBeNull();
      expect(fuzzyMatch("world", "xyz")).toBeNull();
    });

    it("returns a zero-score empty match for an empty query", () => {
      expect(fuzzyMatch("anything", "")).toEqual({ score: 0, positions: [] });
    });

    it("returns null for empty text with a non-empty query", () => {
      expect(fuzzyMatch("", "abc")).toBeNull();
    });

    it("matches case-insensitively by default", () => {
      expect(fuzzyMatch("HELLO", "hlo")?.positions).toEqual([0, 3, 4]);
      expect(fuzzyMatch("hello", "HLO")?.positions).toEqual([0, 3, 4]);
    });

    it("respects case-sensitive mode", () => {
      expect(fuzzyMatch("HELLO", "hlo", { caseSensitive: true })).toBeNull();
      expect(fuzzyMatch("HELLO", "HLO", { caseSensitive: true })?.positions).toEqual([0, 3, 4]);
    });

    it("prefers the contiguous alignment over a scattered one", () => {
      // "a b c abc" contains both a scattered "a b c" and a contiguous "abc";
      // the matcher must pick the contiguous run at the end.
      expect(fuzzyMatch("a b c abc", "abc")?.positions).toEqual([6, 7, 8]);
    });

    it("scores word-start matches higher than mid-word matches", () => {
      const midWord = fuzzyMatch("abc", "bc")?.score ?? -Infinity;
      const wordStart = fuzzyMatch("a bc", "bc")?.score ?? -Infinity;
      expect(wordStart).toBeGreaterThan(midWord);
    });

    it("rewards exact-case letters under case-insensitive mode", () => {
      const exactCase = fuzzyMatch("Hello", "H")?.score ?? -Infinity;
      const otherCase = fuzzyMatch("Hello", "h")?.score ?? -Infinity;
      expect(exactCase).toBeGreaterThan(otherCase);
    });

    it("returns strictly ascending positions", () => {
      const result = fuzzyMatch("foo bar baz", "fbb");
      expect(result).not.toBeNull();
      const positions = result!.positions;
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });

    it("treats CJK ideographs as word boundaries", () => {
      // 你好世界: 你0 好1 世2 界3. Matching "好世" lands on [1, 2].
      expect(fuzzyMatch("你好世界", "好世")?.positions).toEqual([1, 2]);
      expect(fuzzyMatch("你好世界", "世界")?.positions).toEqual([2, 3]);
    });

    it("finds one fuzzy match per line with absolute document offsets", () => {
      const doc = "abc\naxbxc";
      expect(findSearchMatches(doc, "abc", { fuzzy: true })).toEqual([
        { from: 0, to: 3, text: "abc" },
        { from: 4, to: 9, text: "axbxc" }
      ]);
    });

    it("skips lines that do not contain the query as a subsequence", () => {
      const doc = "hello world\nfoo bar\nabc";
      expect(findSearchMatches(doc, "hl", { fuzzy: true })).toEqual([
        { from: 0, to: 3, text: "hel" }
      ]);
    });

    it("matches case-insensitively across lines", () => {
      const matches = findSearchMatches("Hello\nHELLO", "hlo", { fuzzy: true });
      expect(matches).toEqual([
        { from: 0, to: 5, text: "Hello" },
        { from: 6, to: 11, text: "HELLO" }
      ]);
    });

    it("takes precedence over regexp and wholeWord when fuzzy is enabled", () => {
      // Under regexp, "a.c" matches "aXc"; under fuzzy the literal '.' is
      // required and absent, so fuzzy wins and yields no match.
      expect(findSearchMatches("aXc", "a.c", { fuzzy: true, regexp: true })).toEqual([]);
      expect(findSearchMatches("aXc", "a.c", { regexp: true })).toEqual([
        { from: 0, to: 3, text: "aXc" }
      ]);
      // wholeWord is ignored under fuzzy — the subsequence still matches.
      expect(findSearchMatches("cat catalog", "cat", { fuzzy: true, wholeWord: true })).toEqual([
        { from: 0, to: 3, text: "cat" }
      ]);
    });

    it("returns an empty array for an empty fuzzy query", () => {
      expect(findSearchMatches("abc", "", { fuzzy: true })).toEqual([]);
    });

    it("leaves the document unchanged when replacing with fuzzy enabled", () => {
      expect(replaceAllMatches("abc", "abc", "X", { fuzzy: true })).toBe("abc");
    });

    it("handles CRLF line endings (\\r\\n) correctly without including \\r in matched text or disrupting offsets", () => {
      const doc = "abc\r\naxbxc\r\nfoo";
      expect(findSearchMatches(doc, "abc", { fuzzy: true })).toEqual([
        { from: 0, to: 3, text: "abc" },
        { from: 5, to: 10, text: "axbxc" }
      ]);
    });
  });
});
