import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import {
  createSearchPlugin,
  findSearchMatches,
  replaceAllMatches
} from "../src/index";

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

  it("finds whole-word matches only", () => {
    expect(findSearchMatches("cat scatter cat", "cat", { wholeWord: true })).toEqual([
      { from: 0, to: 3, text: "cat" },
      { from: 12, to: 15, text: "cat" }
    ]);
  });

  it("finds whole-word matches with case sensitivity", () => {
    expect(findSearchMatches("Cat cat CAT", "cat", { wholeWord: true, caseSensitive: true })).toEqual([
      { from: 4, to: 7, text: "cat" }
    ]);
  });

  it("replaces whole-word matches only", () => {
    expect(replaceAllMatches("cat scatter cat", "cat", "dog", { wholeWord: true })).toBe("dog scatter dog");
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

  it("finds fuzzy matches in a document", () => {
    expect(findSearchMatches("hello world test", "hel", { fuzzy: true })).toEqual([
      { from: 0, to: 5, text: "hello" }
    ]);
  });

  it("finds fuzzy matches with case sensitivity", () => {
    expect(findSearchMatches("Hello hello", "Hlo", { fuzzy: true, caseSensitive: true })).toEqual([
      { from: 0, to: 5, text: "Hello" }
    ]);
  });

  it("replaces fuzzy matches only", () => {
    expect(replaceAllMatches("hello world", "hel", "X", { fuzzy: true })).toBe("X world");
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
