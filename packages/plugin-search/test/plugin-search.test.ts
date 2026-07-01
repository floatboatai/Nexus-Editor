import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import {
  createSearchPlugin,
  findSearchMatches,
  replaceAllMatches
} from "../src/index";

const HISTORY_KEY = "nexus:test-search-history";

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

  it("matches whole-word CJK text delimited by punctuation", () => {
    expect(findSearchMatches("你好，世界！", "世界", { wholeWord: true })).toEqual([
      { from: 3, to: 5, text: "世界" }
    ]);
  });

  it("does not treat a query inside uninterrupted CJK text as a whole word", () => {
    expect(findSearchMatches("你好世界和平", "世界", { wholeWord: true })).toEqual([]);
  });

  it("does not add the Unicode flag when whole-word is disabled", () => {
    expect(findSearchMatches("banana", "\\a", { regexp: true })).toEqual([
      { from: 1, to: 2, text: "a" },
      { from: 3, to: 4, text: "a" },
      { from: 5, to: 6, text: "a" }
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

  describe("Unicode whole-word boundaries", () => {
    it("matches Cyrillic script as a whole word", () => {
      expect(findSearchMatches("Привет, мир", "Привет", { wholeWord: true })).toEqual([
        { from: 0, to: 6, text: "Привет" }
      ]);
    });

    it("matches precomposed accented Latin as a whole word", () => {
      expect(findSearchMatches("café noir", "café", { wholeWord: true })).toEqual([
        { from: 0, to: 4, text: "café" }
      ]);
    });

    it("does not match a query that is a substring of a longer accented word", () => {
      expect(findSearchMatches("decaféine", "café", { wholeWord: true })).toEqual([]);
    });

    it("matches Hangul as a whole word", () => {
      expect(findSearchMatches("한글 문서", "한글", { wholeWord: true })).toEqual([
        { from: 0, to: 2, text: "한글" }
      ]);
    });

    it("keeps a base letter attached to a following combining mark", () => {
      // "e" + combining acute accent (U+0301) + "clair" — the query "e" is not
      // a whole word because \p{M} keeps the combining mark attached to it.
      expect(findSearchMatches("éclair", "e", { wholeWord: true })).toEqual([]);
    });

    it("keeps consecutive combining marks attached to their base letter", () => {
      // base "a" + two combining marks (circumflex U+0302, acute U+0301) + "bc"
      const word = "ấbc";
      const doc = `${word} def`;
      expect(findSearchMatches(doc, "bc", { wholeWord: true })).toEqual([]);
      expect(findSearchMatches(doc, word, { wholeWord: true })).toEqual([
        { from: 0, to: 5, text: word }
      ]);
    });

    it("returns exact UTF-16 offsets for astral-plane letters", () => {
      // U+1D4B3/U+1D4B4 (mathematical script capital X/Y) are each a surrogate
      // pair, so the two-letter match spans 4 UTF-16 code units.
      expect(findSearchMatches("\u{1D4B3}\u{1D4B4} rest", "\u{1D4B3}\u{1D4B4}", { wholeWord: true })).toEqual([
        { from: 0, to: 4, text: "\u{1D4B3}\u{1D4B4}" }
      ]);
    });

    it("treats digits and underscores as word characters", () => {
      expect(findSearchMatches("item_1 item", "item", { wholeWord: true })).toEqual([
        { from: 7, to: 11, text: "item" }
      ]);
      expect(findSearchMatches("cat3 cat", "cat", { wholeWord: true })).toEqual([
        { from: 5, to: 8, text: "cat" }
      ]);
    });

    it("matches at the start and end of the document", () => {
      expect(findSearchMatches("cat scatter", "cat", { wholeWord: true })).toEqual([
        { from: 0, to: 3, text: "cat" }
      ]);
      expect(findSearchMatches("scatter cat", "cat", { wholeWord: true })).toEqual([
        { from: 8, to: 11, text: "cat" }
      ]);
    });

    it("treats CRLF line endings as a boundary", () => {
      expect(findSearchMatches("line1\r\nline1", "line1", { wholeWord: true })).toEqual([
        { from: 0, to: 5, text: "line1" },
        { from: 7, to: 12, text: "line1" }
      ]);
    });

    it("treats an adjacent emoji as a boundary", () => {
      expect(findSearchMatches("hello\u{1F600}world", "hello", { wholeWord: true })).toEqual([
        { from: 0, to: 5, text: "hello" }
      ]);
    });

    it("matches a literal query containing punctuation by its outer edges", () => {
      expect(findSearchMatches("what it's up", "it's", { wholeWord: true })).toEqual([
        { from: 5, to: 9, text: "it's" }
      ]);
    });

    it("evaluates a zero-width regexp query by the same adjacent-character rule", () => {
      expect(findSearchMatches(". .", "(?= )", { regexp: true, wholeWord: true })).toEqual([
        { from: 1, to: 1, text: "" }
      ]);
    });

    it("supports capture groups and alternation combined with whole-word", () => {
      expect(
        findSearchMatches("cat123 dogcat456", "(?:cat|dog)\\d+", { regexp: true, wholeWord: true })
      ).toEqual([{ from: 0, to: 6, text: "cat123" }]);
    });

    it("keeps $1/$& replacement templates working with whole-word regexp", () => {
      expect(
        replaceAllMatches("cat123 dogcat456", "(cat)\\d+", "[$1]", { regexp: true, wholeWord: true })
      ).toBe("[cat] dogcat456");
    });

    it("replaces whole-word CJK matches via the shared pattern", () => {
      expect(replaceAllMatches("你好，世界！", "世界", "地球", { wholeWord: true })).toBe(
        "你好，地球！"
      );
    });

    it("is a no-op replace when there is no whole-word match", () => {
      expect(replaceAllMatches("catalog", "cat", "dog", { wholeWord: true })).toBe("catalog");
    });

    it("does not accept Unicode case folding as a substitute for legacy escape validity", () => {
      // "\a" is a legacy no-op escape under non-Unicode flags but an invalid
      // escape once whole-word adds the `u` flag — it must fall back cleanly
      // rather than throwing or matching something unintended.
      expect(findSearchMatches("banana", "\\a", { regexp: true, wholeWord: true })).toEqual([]);
      expect(replaceAllMatches("banana", "\\a", "X", { regexp: true, wholeWord: true })).toBe("banana");
    });

    it("falls back to the original document for an invalid regexp combined with whole-word", () => {
      expect(replaceAllMatches("hello", "[bad(", "x", { regexp: true, wholeWord: true })).toBe("hello");
      expect(findSearchMatches("hello", "[bad(", { regexp: true, wholeWord: true })).toEqual([]);
    });
  });

  it("creates a search plugin descriptor", () => {
    const plugin = createSearchPlugin();

    expect(plugin.name).toBe("plugin-search");
    expect(plugin.cmExtensions).toHaveLength(3);
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
});
