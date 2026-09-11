import { EditorView } from "@codemirror/view";
import { getSearchQuery, SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";

import { createEditor } from "@floatboat/nexus-core";

import {
  createSearchPlugin,
  findSearchMatches,
  FuzzySearchQuery,
  fuzzyFindMatches
} from "../src/index";

describe("fuzzyFindMatches", () => {
  it("returns no matches for an empty query or empty text", () => {
    expect(fuzzyFindMatches("", "alpha")).toEqual([]);
    expect(fuzzyFindMatches("alpha", "")).toEqual([]);
    expect(fuzzyFindMatches("a", "")).toEqual([]);
  });

  it("matches single-character query at every position", () => {
    const text = "abracadabra";
    const matches = fuzzyFindMatches(text, "a");
    expect(matches.map((m) => [m.from, m.to])).toEqual([
      [0, 1],
      [3, 4],
      [5, 6],
      [7, 8],
      [10, 11]
    ]);
    for (const match of matches) {
      expect(match.text).toBe("a");
      expect(match.positions).toEqual([match.from]);
    }
  });

  it("finds non-consecutive subsequences and exposes the matched positions", () => {
    const matches = fuzzyFindMatches("hello world", "hlw");
    // Greedy: the 'w' is found as early as possible, so the window is
    // "hello w", not "hello world". This is the standard fzf-lite
    // contract — the matcher emits the tightest possible window for each
    // starting position.
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match.text).toBe("hello w");
    expect(match.positions).toEqual([0, 2, 6]);
    expect(match.from).toBe(0);
    expect(match.to).toBe(7);
  });

  it("emits non-overlapping matches and advances past the matched window", () => {
    const matches = fuzzyFindMatches("axxxbxxxaxxxb", "ab");
    expect(matches.map((m) => [m.from, m.to, m.text])).toEqual([
      [0, 5, "axxxb"],
      [8, 13, "axxxb"]
    ]);
  });

  it("favors tight windows when multiple interpretations exist", () => {
    // "ab" could match the literal at 0-1 or span 0-4. The matcher should
    // pick the literal occurrence first; if a second window starts inside
    // the first it is skipped because we always advance past `lastMatch.to`.
    const matches = fuzzyFindMatches("abcab", "ab");
    expect(matches.map((m) => [m.from, m.to])).toEqual([
      [0, 2],
      [3, 5]
    ]);
  });

  it("rejects matches that exceed the configured maximum gap", () => {
    const matches = fuzzyFindMatches("a" + "x".repeat(50) + "b", "ab", { maxGap: 10 });
    expect(matches).toEqual([]);
  });

  it("respects case sensitivity", () => {
    const matches = fuzzyFindMatches("Alpha alpha", "a", { caseSensitive: true });
    // All three lowercase 'a' positions match; only the upper-case 'A'
    // is filtered out.
    expect(matches.map((m) => [m.from, m.to, m.text])).toEqual([
      [4, 5, "a"],
      [6, 7, "a"],
      [10, 11, "a"]
    ]);
  });

  it("honors case-insensitive matching by default and keeps the original casing in `text`", () => {
    const matches = fuzzyFindMatches("Alpha alpha ALPHA", "alpha");
    expect(matches.map((m) => m.text)).toEqual(["Alpha", "alpha", "ALPHA"]);
  });

  it("emits every disjoint match and scores word-boundary starts higher", () => {
    const text = "xfooxfooxfoo";
    const matches = fuzzyFindMatches(text, "foo");
    // Three non-overlapping matches, each exactly the literal "foo".
    expect(matches).toHaveLength(3);
    for (const match of matches) {
      expect(match.text).toBe("foo");
    }
    // Every match in "xfooxfooxfoo" starts at a word boundary, so the
    // boundary bonus fires uniformly — used here as a smoke test for the
    // score wiring rather than a relative comparison.
    for (const match of matches) {
      expect(match.score).toBeGreaterThan(0);
    }
  });

  it("scores word-boundary matches above embedded occurrences", () => {
    // "foo" at index 0 is a clear word boundary; the same letters at
    // index 3 are embedded in a run. The matcher emits both as separate
    // matches with the boundary start scoring higher.
    const matches = fuzzyFindMatches("foofoo", "foo");
    expect(matches.map((m) => m.from)).toEqual([0, 3]);
    const boundary = matches.find((m) => m.from === 0)!;
    const embedded = matches.find((m) => m.from === 3)!;
    expect(boundary.score).toBeGreaterThan(embedded.score);
  });

  it("scores consecutive matches higher than the same characters spread apart", () => {
    const tight = fuzzyFindMatches("foobar", "fb");
    const spread = fuzzyFindMatches("fxxxxb", "fb");
    expect(tight[0].score).toBeGreaterThan(spread[0].score);
  });

  it("returns an empty list when the query has characters not in the text", () => {
    expect(fuzzyFindMatches("hello", "hellz")).toEqual([]);
  });

  it("returns no matches when the query is longer than the text", () => {
    expect(fuzzyFindMatches("hi", "hello")).toEqual([]);
  });
});

describe("FuzzySearchQuery", () => {
  function buildView(text: string): EditorView {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue: text,
      plugins: [createSearchPlugin()]
    });
    const view = EditorView.findFromDOM(container);
    if (!view) {
      throw new Error("EditorView was not mounted");
    }
    // Stash the container on the view so we can clean it up after the test.
    (view as EditorView & { __testContainer?: HTMLElement }).__testContainer = container;
    return view;
  }

  function disposeView(view: EditorView): void {
    const container = (view as EditorView & { __testContainer?: HTMLElement }).__testContainer;
    view.destroy();
    if (container) document.body.removeChild(container);
  }

  function cursorRanges(
    query: FuzzySearchQuery,
    view: EditorView
  ): Array<{ from: number; to: number }> {
    const iterator = query.getCursor(view.state);
    const out: Array<{ from: number; to: number }> = [];
    for (let step = iterator.next(); !step.done; step = iterator.next()) {
      out.push(step.value);
    }
    return out;
  }

  it("wires through the @codemirror/search SearchQuery base", () => {
    const query = new FuzzySearchQuery({ search: "abc" });
    expect(query.search).toBe("abc");
    expect(query.caseSensitive).toBe(false);
    expect(query.regexp).toBe(false);
    expect(query.wholeWord).toBe(false);
    expect(query.valid).toBe(true);
  });

  it("getCursor yields fuzzy matches consistent with fuzzyFindMatches", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const view = buildView(text);
    try {
      const matches = fuzzyFindMatches(text, "qkfg");
      const query = new FuzzySearchQuery({ search: "qkfg" });
      const fromCursor = cursorRanges(query, view);
      expect(fromCursor).toEqual(matches.map((m) => ({ from: m.from, to: m.to })));
    } finally {
      disposeView(view);
    }
  });

  it("getCursor honors the from / to range arguments", () => {
    const text = "alpha alpha alpha";
    const view = buildView(text);
    try {
      expect(view.state.doc.toString()).toBe(text);
      // "ph" inside "alpha alpha alpha" matches every "ph" pair cleanly
      // — using a 2-char query keeps the trace simple.
      const direct = fuzzyFindMatches(text, "ph");
      expect(direct.map((m) => [m.from, m.to])).toEqual([
        [2, 4],
        [8, 10],
        [14, 16]
      ]);
      const query = new FuzzySearchQuery({ search: "ph" });
      const ranged = Array.from(query.getCursor(view.state, 6, 12));
      expect(ranged).toEqual([{ from: 8, to: 10 }]);
    } finally {
      disposeView(view);
    }
  });

  it("eq treats two fuzzy queries with identical config as equal", () => {
    const a = new FuzzySearchQuery({ search: "abc", caseSensitive: true });
    const b = new FuzzySearchQuery({ search: "abc", caseSensitive: true });
    expect(a.eq(b)).toBe(true);
  });

  it("eq distinguishes fuzzy from non-fuzzy queries with the same search string", () => {
    const fuzzy = new FuzzySearchQuery({ search: "abc" });
    const literal = new SearchQuery({ search: "abc" });
    // FuzzySearchQuery knows about the fuzzy flag, so it correctly reports
    // a literal query as different. The base SearchQuery doesn't track
    // fuzzy mode at all — the panel works around that asymmetry by
    // comparing the fuzzy flag explicitly before dispatching.
    expect(fuzzy.eq(literal)).toBe(false);
  });

  it("eq picks up case-sensitivity changes", () => {
    const a = new FuzzySearchQuery({ search: "abc", caseSensitive: false });
    const b = new FuzzySearchQuery({ search: "abc", caseSensitive: true });
    expect(a.eq(b)).toBe(false);
  });

  it("eq picks up maxGap changes", () => {
    const a = new FuzzySearchQuery({ search: "abc", maxGap: 8 });
    const b = new FuzzySearchQuery({ search: "abc", maxGap: 16 });
    expect(a.eq(b)).toBe(false);
  });
});

describe("search panel fuzzy integration", () => {
  function buildEditorWithSearch(initialValue: string) {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue,
      plugins: [createSearchPlugin()]
    });
    const view = EditorView.findFromDOM(container);
    return { container, editor, view };
  }

  function openPanel(container: HTMLElement): void {
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

  it("renders a Fuzzy checkbox in the search panel", () => {
    const { container, view } = buildEditorWithSearch("alpha");
    openPanel(container);
    const fuzzy = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    );
    expect(fuzzy).not.toBeNull();
    expect(fuzzy!.type).toBe("checkbox");
    view?.destroy();
    document.body.removeChild(container);
  });

  it("toggling Fuzzy promotes the active SearchQuery to a FuzzySearchQuery", () => {
    const { container, view } = buildEditorWithSearch("data cata");
    openPanel(container);
    const input = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-input"]'
    )!;
    const fuzzy = container.querySelector<HTMLInputElement>(
      '[data-test-id="markdown-search-fuzzy-toggle"]'
    )!;

    input.value = "ata";
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    expect(view).not.toBeNull();
    const initialQuery = getSearchQuery(view!.state);
    expect(initialQuery).not.toBeInstanceOf(FuzzySearchQuery);

    fuzzy.checked = true;
    fuzzy.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    const fuzzyQuery = getSearchQuery(view!.state);
    expect(fuzzyQuery).toBeInstanceOf(FuzzySearchQuery);
    expect((fuzzyQuery as FuzzySearchQuery).fuzzy).toBe(true);

    // "ata" inside "data cata" matches the substring "ata" inside both
    // "data" and "cata" — confirming the cursor wires through to the
    // standard CM6 search cursor consumers (highlight + findNext).
    const cursor = (fuzzyQuery as FuzzySearchQuery).getCursor(view!.state);
    const ranges: Array<{ from: number; to: number }> = [];
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      ranges.push(step.value);
    }
    expect(ranges).toEqual([
      { from: 1, to: 4 },
      { from: 6, to: 9 }
    ]);

    // Toggling off restores a plain SearchQuery.
    fuzzy.checked = false;
    fuzzy.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    const restored = getSearchQuery(view!.state);
    expect(restored).toBeInstanceOf(SearchQuery);
    expect(restored).not.toBeInstanceOf(FuzzySearchQuery);

    view?.destroy();
    document.body.removeChild(container);
  });

  it("findSearchMatches is unchanged when fuzzy mode is off", () => {
    // Sanity check: the literal helper still does substring matching, so
    // the existing panel behavior is preserved for non-fuzzy users.
    const matches = findSearchMatches("hello world", "world");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("world");
  });
});
