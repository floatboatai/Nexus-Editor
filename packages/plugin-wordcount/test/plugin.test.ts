import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";

import { countMarkdown } from "../src/count";
import {
  attachWordCountPlugin,
  createWordCountPlugin,
  type WordCountState
} from "../src/plugin";

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("createWordCountPlugin", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  it("computes initial stats consistent with countMarkdown", async () => {
    const wordcount = createWordCountPlugin();
    editor = createEditor({
      container,
      initialValue: "Hello world.\n\nSecond paragraph.",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);

    await flushMicrotasks();

    const expected = countMarkdown("Hello world.\n\nSecond paragraph.", { ast: editor.getAst() });
    expect(wordcount.getStats()).toEqual(expected);
  });

  it("emits initial state synchronously on subscribe", async () => {
    const wordcount = createWordCountPlugin();
    editor = createEditor({ container, initialValue: "alpha beta", plugins: [wordcount] });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const listener = vi.fn();
    const unsubscribe = wordcount.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.doc?.words).toBe(2);
    unsubscribe();
  });

  it("recomputes after the debounce window when the document changes", async () => {
    vi.useFakeTimers();
    try {
      const wordcount = createWordCountPlugin({ debounceMs: 50 });
      editor = createEditor({ container, initialValue: "one two", plugins: [wordcount] });
      attachWordCountPlugin(wordcount, editor);
      await vi.runAllTimersAsync();

      const listener = vi.fn();
      wordcount.subscribe(listener);
      listener.mockClear();

      editor.setDocument("one two three four five");
      // synchronous recompute should NOT have fired yet
      expect(listener).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60);
      expect(listener).toHaveBeenCalled();
      expect(wordcount.getStats().words).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses bursts of edits into a single debounced emission", async () => {
    vi.useFakeTimers();
    try {
      const wordcount = createWordCountPlugin({ debounceMs: 100 });
      editor = createEditor({ container, initialValue: "a", plugins: [wordcount] });
      attachWordCountPlugin(wordcount, editor);
      await vi.runAllTimersAsync();

      const listener = vi.fn();
      wordcount.subscribe(listener);
      listener.mockClear();

      editor.setDocument("a b");
      editor.setDocument("a b c");
      editor.setDocument("a b c d");
      expect(listener).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(150);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(wordcount.getStats().words).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates selection stats synchronously without debouncing", async () => {
    const wordcount = createWordCountPlugin();
    editor = createEditor({
      container,
      initialValue: "alpha bravo charlie delta",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const states: WordCountState[] = [];
    wordcount.subscribe((state) => states.push(state));
    states.length = 0;

    editor.setSelection(0, "alpha bravo".length);
    expect(wordcount.isSelectionActive()).toBe(true);
    expect(wordcount.getSelectionStats().words).toBe(2);
    expect(states.length).toBeGreaterThan(0);

    editor.setSelection(0, 0);
    expect(wordcount.isSelectionActive()).toBe(false);
    expect(wordcount.getSelectionStats().words).toBe(0);
  });

  it("destroy detaches listeners and silences further emissions", async () => {
    const wordcount = createWordCountPlugin({ debounceMs: 0 });
    editor = createEditor({ container, initialValue: "hello", plugins: [wordcount] });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const listener = vi.fn();
    wordcount.subscribe(listener);
    listener.mockClear();

    wordcount.destroy();
    editor.setDocument("hello world");

    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
  });

  it("respects custom cjkUnit and exclude options", async () => {
    const wordcount = createWordCountPlugin({
      cjkUnit: "word",
      exclude: ["code", "inlineCode", "math", "inlineMath", "html", "yaml", "image"]
    });
    editor = createEditor({
      container,
      initialValue: "你好世界 ![cat](cat.png)",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    expect(wordcount.getStats().words).toBe(1);
  });
});

describe("createWordCountPlugin — status bar", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
    document.querySelectorAll('[data-test-id="nexus-wordcount-bar"]').forEach((el) => el.remove());
  });

  it("mounts a status bar when statusBar option is supplied", async () => {
    const wordcount = createWordCountPlugin({ statusBar: {} });
    editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const bar = document.querySelector('[data-test-id="nexus-wordcount-bar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("role")).toBe("status");
    expect(bar?.getAttribute("aria-live")).toBe("polite");
    expect(bar?.textContent).toContain("2");
    expect(bar?.textContent).toContain("words");
  });

  it("renders a selection summary that hides when selection collapses", async () => {
    const wordcount = createWordCountPlugin({ statusBar: {} });
    editor = createEditor({
      container,
      initialValue: "alpha bravo charlie",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const selectionSpan = document.querySelector<HTMLElement>('[data-test-id="nexus-wordcount-selection"]');
    expect(selectionSpan).not.toBeNull();
    expect(selectionSpan?.hidden).toBe(true);

    editor.setSelection(0, "alpha bravo".length);
    expect(selectionSpan?.hidden).toBe(false);
    expect(selectionSpan?.textContent).toContain("Selected");
    expect(selectionSpan?.textContent).toContain("2");

    editor.setSelection(0, 0);
    expect(selectionSpan?.hidden).toBe(true);
  });

  it("supports localised labels", async () => {
    const wordcount = createWordCountPlugin({
      statusBar: {
        labels: {
          words: "字",
          characters: "字符",
          readingTime: "分钟阅读",
          readingTimeShort: "<1 分钟"
        }
      }
    });
    editor = createEditor({
      container,
      initialValue: "你好 世界",
      plugins: [wordcount]
    });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    const bar = document.querySelector<HTMLElement>('[data-test-id="nexus-wordcount-bar"]');
    expect(bar?.textContent).toContain("字");
    expect(bar?.textContent).toContain("字符");
  });

  it("destroy() removes the status-bar element", async () => {
    const wordcount = createWordCountPlugin({ statusBar: {} });
    editor = createEditor({ container, initialValue: "x", plugins: [wordcount] });
    attachWordCountPlugin(wordcount, editor);
    await flushMicrotasks();

    expect(document.querySelector('[data-test-id="nexus-wordcount-bar"]')).not.toBeNull();
    wordcount.destroy();
    expect(document.querySelector('[data-test-id="nexus-wordcount-bar"]')).toBeNull();
  });
});
