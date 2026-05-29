import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import {
  createSearchPlugin,
  findSearchMatches,
  replaceAllMatches
} from "../src/index";

// ------------------------------------------------------------------
// findSearchMatches — basic
// ------------------------------------------------------------------

describe("findSearchMatches", () => {
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

  it("returns empty array for empty query", () => {
    expect(findSearchMatches("hello", "")).toEqual([]);
  });

  it("escapes regex metacharacters in the query", () => {
    expect(findSearchMatches("price is $10.00 (USD)", "$10.00")).toEqual([
      { from: 9, to: 15, text: "$10.00" }
    ]);
  });
});

// ------------------------------------------------------------------
// findSearchMatches — whole-word matching
// ------------------------------------------------------------------

describe("findSearchMatches — wholeWord", () => {
  it("matches only whole words when wholeWord is true", () => {
    // "cat" appears inside "scatter" — should be excluded
    expect(findSearchMatches("cat scatter cat", "cat", { wholeWord: true })).toEqual([
      { from: 0, to: 3, text: "cat" },
      { from: 12, to: 15, text: "cat" }
    ]);
  });

  it("matches whole word at document start", () => {
    expect(findSearchMatches("hello world", "hello", { wholeWord: true })).toEqual([
      { from: 0, to: 5, text: "hello" }
    ]);
  });

  it("matches whole word at document end", () => {
    expect(findSearchMatches("say hello", "hello", { wholeWord: true })).toEqual([
      { from: 4, to: 9, text: "hello" }
    ]);
  });

  it("excludes substring matches within longer words", () => {
    expect(findSearchMatches("testing test tester", "test", { wholeWord: true })).toEqual([
      { from: 8, to: 12, text: "test" }
    ]);
  });

  it("handles word adjacent to punctuation", () => {
    expect(findSearchMatches("hello, world!", "hello", { wholeWord: true })).toEqual([
      { from: 0, to: 5, text: "hello" }
    ]);
    expect(findSearchMatches("hello, world!", "world", { wholeWord: true })).toEqual([
      { from: 7, to: 12, text: "world" }
    ]);
  });

  it("handles word adjacent to markdown syntax", () => {
    expect(findSearchMatches("**bold** text", "bold", { wholeWord: true })).toEqual([
      { from: 2, to: 6, text: "bold" }
    ]);
  });

  it("handles single-character word", () => {
    expect(findSearchMatches("a and b or c", "b", { wholeWord: true })).toEqual([
      { from: 6, to: 7, text: "b" }
    ]);
  });

  it("works with case-insensitive + whole-word combined", () => {
    expect(findSearchMatches("Cat scatter CAT", "cat", { wholeWord: true })).toEqual([
      { from: 0, to: 3, text: "Cat" },
      { from: 12, to: 15, text: "CAT" }
    ]);
  });

  it("works with case-sensitive + whole-word combined", () => {
    expect(findSearchMatches("Cat scatter CAT", "cat", { wholeWord: true, caseSensitive: true })).toEqual([]);
  });

  it("returns empty when no whole-word match exists", () => {
    expect(findSearchMatches("cats category catalog", "cat", { wholeWord: true })).toEqual([]);
  });
});

// ------------------------------------------------------------------
// replaceAllMatches — basic
// ------------------------------------------------------------------

describe("replaceAllMatches", () => {
  it("replaces all matches in a document", () => {
    expect(replaceAllMatches("cat scatter cat", "cat", "dog")).toBe("dog sdogter dog");
  });

  it("returns doc unchanged for empty query", () => {
    expect(replaceAllMatches("hello", "", "world")).toBe("hello");
  });
});

// ------------------------------------------------------------------
// replaceAllMatches — whole-word matching
// ------------------------------------------------------------------

describe("replaceAllMatches — wholeWord", () => {
  it("replaces only whole-word matches", () => {
    expect(replaceAllMatches("cat scatter cat", "cat", "dog", { wholeWord: true })).toBe("dog scatter dog");
  });

  it("preserves substring occurrences inside other words", () => {
    expect(replaceAllMatches("testing test tester", "test", "exam", { wholeWord: true })).toBe("testing exam tester");
  });

  it("handles multiple whole-word replacements", () => {
    expect(replaceAllMatches("the cat sat on the mat", "the", "a", { wholeWord: true })).toBe(
      "a cat sat on a mat"
    );
  });

  it("works with case-insensitive + whole-word", () => {
    expect(replaceAllMatches("Cat scatter CAT", "cat", "dog", { wholeWord: true })).toBe("dog scatter dog");
  });
});

// ------------------------------------------------------------------
// createSearchPlugin
// ------------------------------------------------------------------

describe("@floatboat/nexus-plugin-search", () => {
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
