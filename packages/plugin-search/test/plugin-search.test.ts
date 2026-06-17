import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import {
  createSearchPlugin,
  findSearchMatches,
  openSearchPanelIn,
  replaceAllMatches
} from "../src/index";

function openSearchPanel(container: HTMLElement): void {
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

  it("replaces all matches in a document", () => {
    expect(replaceAllMatches("cat scatter cat", "cat", "dog")).toBe("dog sdogter dog");
  });

  describe("whole-word matching", () => {
    it("matches only standalone words when wholeWord is true", () => {
      expect(findSearchMatches("cat scatter cat", "cat", { wholeWord: true })).toEqual([
        { from: 0, to: 3, text: "cat" },
        { from: 12, to: 15, text: "cat" }
      ]);
    });

    it("still matches substrings when wholeWord is false or omitted", () => {
      const expected = [
        { from: 0, to: 3, text: "cat" },
        { from: 5, to: 8, text: "cat" },
        { from: 12, to: 15, text: "cat" }
      ];
      expect(findSearchMatches("cat scatter cat", "cat")).toEqual(expected);
      expect(findSearchMatches("cat scatter cat", "cat", { wholeWord: false })).toEqual(expected);
    });

    it("treats punctuation as word boundaries", () => {
      expect(findSearchMatches("word, word.", "word", { wholeWord: true })).toEqual([
        { from: 0, to: 4, text: "word" },
        { from: 6, to: 10, text: "word" }
      ]);
    });

    it("combines wholeWord with caseSensitive", () => {
      expect(findSearchMatches("Hello hello", "hello", { wholeWord: true, caseSensitive: true })).toEqual([
        { from: 6, to: 11, text: "hello" }
      ]);
    });

    it("replaces only whole words", () => {
      expect(replaceAllMatches("cat scatter cat", "cat", "dog", { wholeWord: true })).toBe(
        "dog scatter dog"
      );
    });

    it("returns empty matches for empty query", () => {
      expect(findSearchMatches("anything", "", { wholeWord: true })).toEqual([]);
    });
  });

  it("openSearchPanelIn opens the CM6 search panel", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta alpha",
      plugins: [createSearchPlugin()]
    });

    expect(openSearchPanelIn(container)).toBe(true);
    expect(container.querySelector('[data-test-id="markdown-search-bar"]')).not.toBeNull();

    editor.destroy();
    container.remove();
  });

  it("CM6 panel replace all respects whole-word", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "cat scatter cat",
      plugins: [createSearchPlugin()]
    });

    openSearchPanel(container);

    const input = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-input"]');
    const wordToggle = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-word-toggle"]');
    expect(input).not.toBeNull();
    expect(wordToggle).not.toBeNull();

    input!.value = "cat";
    input!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    wordToggle!.checked = true;
    wordToggle!.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    const replaceInput = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-replace-input"]'
    );
    expect(replaceInput).not.toBeNull();
    replaceInput!.value = "dog";
    replaceInput!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

    const replaceAllButton = container.querySelector<HTMLButtonElement>(
      '[data-test-id="markdown-search-replace-all"]'
    );
    replaceAllButton?.click();

    expect(editor.getDocument()).toBe("dog scatter dog");

    editor.destroy();
    container.remove();
  });

  it("shows match count for the active query", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: "alpha beta alpha",
      plugins: [createSearchPlugin()]
    });

    openSearchPanel(container);

    const input = container.querySelector<HTMLInputElement>('[data-test-id="markdown-search-input"]');
    const count = container.querySelector<HTMLElement>('[data-test-id="markdown-search-match-count"]');
    expect(input).not.toBeNull();
    expect(count).not.toBeNull();

    input!.value = "alpha";
    input!.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(count!.textContent).toBe("1 / 2");

    editor.destroy();
    container.remove();
  });

  it("creates a search plugin descriptor", () => {
    const plugin = createSearchPlugin();

    expect(plugin.name).toBe("plugin-search");
    expect(plugin.cmExtensions).toHaveLength(4);
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
    const replaceRow = container.querySelector<HTMLDivElement>('[data-test-id="markdown-search-replace-row"]');
    expect(nextButton?.textContent).toBe("");
    expect(nextButton?.title).toBe("下一个");
    expect(nextButton?.getAttribute("aria-label")).toBe("下一个");
    expect(nextButton?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-find-row"]')).not.toBeNull();
    expect(container.querySelector('[data-test-id="markdown-search-options-row"]')).not.toBeNull();
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.hidden).not.toBe(true);

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
    expect(replaceButton?.textContent).toBe("Replace");
    expect(replaceAllButton?.getAttribute("aria-label")).toBe("Replace all");
    expect(replaceAllButton?.title).toBe("Replace all");
    expect(replaceAllButton?.textContent).toBe("Replace all");

    editor.destroy();
    container.remove();
  });
});
