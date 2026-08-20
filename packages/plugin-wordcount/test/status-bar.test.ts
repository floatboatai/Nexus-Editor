import { describe, expect, it } from "vitest";

import type { WordCountStats } from "../src/count";
import type { WordCountAPI, WordCountState } from "../src/plugin";
import {
  createStatusBar,
  defaultStatusBarLabels,
  type WordCountLabels
} from "../src/status-bar";

const zeroStats = (): WordCountStats => ({
  words: 0,
  latinWords: 0,
  cjkCharacters: 0,
  characters: 0,
  charactersNoSpaces: 0,
  lines: 0,
  paragraphs: 0,
  sentences: 0,
  readingTimeSeconds: 0
});

/**
 * Build a controllable fake WordCountAPI. The real plugin needs a live
 * editor instance, but the status bar only depends on the
 * `subscribe` / `getStats` surface, so we mock exactly that. `subscribe`
 * invokes the listener synchronously with the current state — matching
 * the real plugin's contract.
 */
function makePlugin(initial: Partial<WordCountState> = {}) {
  const state: WordCountState = {
    doc: initial.doc ?? zeroStats(),
    selection: initial.selection ?? zeroStats(),
    isSelectionActive: initial.isSelectionActive ?? false
  };
  const listeners = new Set<(s: WordCountState) => void>();
  const api = {
    state,
    getStats: () => state.doc,
    getSelectionStats: () => state.selection,
    isSelectionActive: () => state.isSelectionActive,
    subscribe(listener: (s: WordCountState) => void) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(next: WordCountState) {
      state.doc = next.doc;
      state.selection = next.selection;
      state.isSelectionActive = next.isSelectionActive;
      for (const l of [...listeners]) l(state);
    },
    destroy() {
      listeners.clear();
    }
  };
  return api as WordCountAPI & { emit: typeof api.emit; state: WordCountState };
}

const byTestId = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-test-id="${id}"]`);

describe("createStatusBar — structure", () => {
  it("returns a handle with an element and a destroy method", () => {
    const plugin = makePlugin();
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(handle.element).toBeInstanceOf(HTMLElement);
    expect(typeof handle.destroy).toBe("function");
  });

  it("mounts to document.body by default and tags the root element", () => {
    const plugin = makePlugin();
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(document.body.contains(handle.element)).toBe(true);
    expect(handle.element.className).toBe("nexus-wordcount__bar");
    expect(handle.element.dataset.testId).toBe("nexus-wordcount-bar");
    expect(handle.element.getAttribute("role")).toBe("status");
    expect(handle.element.getAttribute("aria-live")).toBe("polite");
  });

  it("always renders the words and characters spans", () => {
    const plugin = makePlugin();
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(byTestId(handle.element, "nexus-wordcount-words")).not.toBeNull();
    expect(byTestId(handle.element, "nexus-wordcount-characters")).not.toBeNull();
  });
});

describe("createStatusBar — document rendering", () => {
  it("renders doc word and character counts with default labels", () => {
    const plugin = makePlugin({
      doc: { ...zeroStats(), words: 12, characters: 34 }
    });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(byTestId(handle.element, "nexus-wordcount-words")!.textContent).toBe("12 words");
    expect(byTestId(handle.element, "nexus-wordcount-characters")!.textContent).toBe("34 chars");
  });

  it("shows the short reading-time label when under a minute", () => {
    const plugin = makePlugin({
      doc: { ...zeroStats(), readingTimeSeconds: 42 }
    });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(byTestId(handle.element, "nexus-wordcount-reading-time")!.textContent).toBe(
      defaultStatusBarLabels.readingTimeShort
    );
  });

  it("shows ceil-rounded minutes when over a minute", () => {
    const plugin = makePlugin({
      doc: { ...zeroStats(), readingTimeSeconds: 125 }
    });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    // 125s -> ceil(125/60) = 3 minutes
    expect(byTestId(handle.element, "nexus-wordcount-reading-time")!.textContent).toBe("3 min read");
  });

  it("omits the characters-no-spaces span unless opted in", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), charactersNoSpaces: 30 } });
    const off = createStatusBar(plugin, { locale: "en-US" });
    expect(byTestId(off.element, "nexus-wordcount-characters-no-spaces")).toBeNull();

    const on = createStatusBar(plugin, { locale: "en-US", showCharactersNoSpaces: true });
    const span = byTestId(on.element, "nexus-wordcount-characters-no-spaces")!;
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("30 chars (no spaces)");
  });

  it("omits the reading-time span when showReadingTime is false", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), readingTimeSeconds: 125 } });
    const handle = createStatusBar(plugin, { locale: "en-US", showReadingTime: false });
    expect(byTestId(handle.element, "nexus-wordcount-reading-time")).toBeNull();
  });

  it("omits the selection span when showSelection is false", () => {
    const plugin = makePlugin({ isSelectionActive: true, selection: { ...zeroStats(), words: 3 } });
    const handle = createStatusBar(plugin, { locale: "en-US", showSelection: false });
    expect(byTestId(handle.element, "nexus-wordcount-selection")).toBeNull();
  });
});

describe("createStatusBar — selection rendering", () => {
  it("hides the selection span when no selection is active", () => {
    const plugin = makePlugin({ isSelectionActive: false });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    const span = byTestId(handle.element, "nexus-wordcount-selection")!;
    expect(span.hidden).toBe(true);
    expect(span.getAttribute("aria-hidden")).toBe("true");
  });

  it("reveals and formats the selection summary when active", () => {
    const plugin = makePlugin({
      isSelectionActive: true,
      selection: { ...zeroStats(), words: 5, characters: 28 }
    });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    const span = byTestId(handle.element, "nexus-wordcount-selection")!;
    expect(span.hidden).toBe(false);
    expect(span.hasAttribute("aria-hidden")).toBe(false);
    expect(span.textContent).toBe("Selected: 5 words · 28 chars");
  });

  it("toggles the selection span back to hidden on state change", () => {
    const plugin = makePlugin({ isSelectionActive: true, selection: { ...zeroStats(), words: 5 } });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    const span = byTestId(handle.element, "nexus-wordcount-selection")!;
    expect(span.hidden).toBe(false);

    plugin.emit({ doc: zeroStats(), selection: zeroStats(), isSelectionActive: false });
    expect(span.hidden).toBe(true);
    expect(span.textContent).toBe("");
  });
});

describe("createStatusBar — options", () => {
  it("merges partial label overrides with defaults", () => {
    const labels: Partial<WordCountLabels> = { words: "个词" };
    const plugin = makePlugin({ doc: { ...zeroStats(), words: 7, characters: 20 } });
    const handle = createStatusBar(plugin, { locale: "en-US", labels });
    // overridden
    expect(byTestId(handle.element, "nexus-wordcount-words")!.textContent).toBe("7 个词");
    // untouched default
    expect(byTestId(handle.element, "nexus-wordcount-characters")!.textContent).toBe("20 chars");
  });

  it("honours the locale for number formatting", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), words: 1000 } });
    const handle = createStatusBar(plugin, { locale: "de-DE" });
    // de-DE uses "." as thousands separator
    expect(byTestId(handle.element, "nexus-wordcount-words")!.textContent).toBe("1.000 words");
  });

  it("applies the classPrefix to root and spans", () => {
    const plugin = makePlugin();
    const handle = createStatusBar(plugin, { locale: "en-US", classPrefix: "wc" });
    expect(handle.element.className).toBe("wc__bar");
    expect(byTestId(handle.element, "nexus-wordcount-words")!.className).toBe("wc__words");
  });

  it("mounts into a supplied container instead of document.body", () => {
    const container = document.createElement("div");
    const plugin = makePlugin();
    const handle = createStatusBar(plugin, { locale: "en-US", container });
    expect(container.contains(handle.element)).toBe(true);
    expect(document.body.contains(handle.element)).toBe(false);
  });
});

describe("createStatusBar — lifecycle", () => {
  it("re-renders when the plugin emits a new state", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), words: 1 } });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(byTestId(handle.element, "nexus-wordcount-words")!.textContent).toBe("1 words");

    plugin.emit({ doc: { ...zeroStats(), words: 99 }, selection: zeroStats(), isSelectionActive: false });
    expect(byTestId(handle.element, "nexus-wordcount-words")!.textContent).toBe("99 words");
  });

  it("removes the element and stops reacting after destroy()", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), words: 1 } });
    const handle = createStatusBar(plugin, { locale: "en-US" });
    expect(document.body.contains(handle.element)).toBe(true);

    handle.destroy();
    expect(document.body.contains(handle.element)).toBe(false);

    // emitting after destroy must not throw and must not re-insert the bar
    expect(() =>
      plugin.emit({ doc: { ...zeroStats(), words: 5 }, selection: zeroStats(), isSelectionActive: false })
    ).not.toThrow();
    expect(document.body.contains(handle.element)).toBe(false);
  });

  it("supports two independent bars on the same plugin", () => {
    const plugin = makePlugin({ doc: { ...zeroStats(), words: 1 } });
    const a = createStatusBar(plugin, { locale: "en-US" });
    const b = createStatusBar(plugin, { locale: "en-US", classPrefix: "wc" });
    expect(a.element).not.toBe(b.element);
    expect(document.body.contains(a.element)).toBe(true);
    expect(document.body.contains(b.element)).toBe(true);

    a.destroy();
    expect(document.body.contains(a.element)).toBe(false);
    expect(document.body.contains(b.element)).toBe(true);
  });
});

describe("defaultStatusBarLabels", () => {
  it("is frozen so callers cannot mutate shared defaults", () => {
    expect(Object.isFrozen(defaultStatusBarLabels)).toBe(true);
  });
});
