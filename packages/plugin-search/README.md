# @floatboat/nexus-plugin-search

Search and replace for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor),
including literal, regular-expression, whole-word and **fuzzy (fzf-style)**
matching. The plugin wires into CodeMirror 6's `@codemirror/search` commands,
so `findNext`, `findPrevious`, `replaceNext`, `replaceAll`, `selectMatches` and
search highlights work without any extra code.

- **Literal / regexp / whole-word search** — parity with the built-in
  CodeMirror search panel, with guarded invalid-regexp handling.
- **Fuzzy search** — fzf-like subsequence matching with boundary, camel-case,
  and consecutive-character bonuses; scored with a strict DP plus prefix-gap
  matrix so results feel like fzf.
- **Headless helpers** — `findSearchMatches`, `replaceAllMatches`,
  `findFuzzyMatches`, `replaceFuzzyMatches` work on plain strings outside an
  editor.
- **Search history** — opt-in, host-injected storage; no implicit
  `localStorage`.
- **Rendered table highlights** — search matches inside live-preview tables
  are highlighted via CSS Custom Highlights.

## Install

```bash
pnpm add @floatboat/nexus-plugin-search @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello world\n",
  plugins: [
    createSearchPlugin({
      top: true,
      highlightSelectionMatches: true,
      history: true
    })
  ]
});
```

Press `Ctrl-F` / `Cmd-F` (or call `openSearchPanel(editor.cmView)`) to open the
search panel.

## Fuzzy search

Enable fuzzy matching by default, or toggle it in the panel:

```ts
createSearchPlugin({ fuzzy: true });
```

Fuzzy mode is mutually exclusive with regexp and whole-word: turning it on
clears those options, and turning on regexp or whole-word clears fuzzy.

The matching algorithm is an fzf-style bounded dynamic-programming scorer.
Each line is matched independently; on very long lines the matcher falls back
to a greedy subsequence scan to keep memory and latency bounded.

Headless usage:

```ts
import { findFuzzyMatches, replaceFuzzyMatches } from "@floatboat/nexus-plugin-search";

findFuzzyMatches("hello world", "hlo");
// => [{ from: 0, to: 5, score: 47 }]

replaceFuzzyMatches("alpha beta gamma", "agm", "AGM");
// => "AGM beta gamma"
```

## Headless literal / regexp / whole-word helpers

```ts
import { findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

findSearchMatches("foo bar baz", "ba", { wholeWord: true });
// => [{ from: 8, to: 10, text: "ba" }]

replaceAllMatches("foo bar baz", "ba", "xx", { wholeWord: true });
// => "foo bar xxz"
```

## Search history

History is disabled by default. Pass `history: true` to keep an in-memory
history, or pass explicit storage to persist it:

```ts
createSearchPlugin({
  history: {
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value)
    },
    storageKey: "my-app.search.history",
    maxEntries: 50
  }
});
```

In the search panel, press `ArrowUp` / `ArrowDown` to recall previous queries.

## Options

### `createSearchPlugin(options?)`

| Option | Default | Notes |
|---|---|---|
| `top` | `true` | Render the panel above the editor content. |
| `caseSensitive` | `false` | Enable case-sensitive search by default. |
| `fuzzy` | `false` | Enable fuzzy matching by default. |
| `highlightSelectionMatches` | `true` | Highlight matches around the current selection. |
| `history` | `false` | `boolean` or `SearchHistoryOptions`. |
| `labels` | English | Override any visible label (see below). |

### `SearchPluginLabels`

All panel text can be translated:

```ts
{
  find: "Find",
  replace: "Replace",
  showReplace: "Show replace",
  hideReplace: "Hide replace",
  next: "Next",
  previous: "Previous",
  all: "All",
  matchCase: "Match case",
  regexp: "Regexp",
  byWord: "By word",
  fuzzy: "Fuzzy",
  replaceNext: "Replace",
  replaceAll: "Replace all",
  close: "Close"
}
```

## API reference

| Export | Purpose |
|---|---|
| `createSearchPlugin(options?)` | Create a `NexusPlugin` that adds search/replace. |
| `findSearchMatches(doc, query, options?)` | Find literal / regexp / whole-word matches in a string. |
| `replaceAllMatches(doc, query, replacement, options?)` | Replace all matches in a string. |
| `findFuzzyMatches(doc, pattern, caseSensitive?)` | Find fzf-style fuzzy matches in a string. |
| `replaceFuzzyMatches(doc, pattern, replacement, caseSensitive?)` | Replace the best fuzzy match per occurrence region. |
| `FuzzySearchQuery` | CodeMirror `SearchQuery` subclass for fuzzy mode. |
| `SearchOptions` | `{ caseSensitive?, wholeWord?, regexp?, fuzzy? }` |
| `SearchMatch` | `{ from, to, text }` |
| `SearchPluginOptions` | Plugin factory options. |
| `SearchPluginLabels` | Localisable label overrides. |
| `SearchHistoryOptions` / `SearchHistoryStorage` | History configuration. |

## License

MIT
