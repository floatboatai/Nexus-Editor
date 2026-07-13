# @floatboat/nexus-plugin-search

Search-and-replace for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

- **Three match modes** — exact (default), whole-word, and regex.
- **Fuzzy (subsequence) matching** — opt in with `fuzzy: true` to
  match "hw" against "hello world" without requiring consecutive
  characters.
- **Live replace** — `replaceAllMatches` rewrites a document string
  in one pass, left-to-right, with consistent position math.
- **History persisted or in-memory** — opt-in `history` option with a
  bring-your-own `SearchHistoryStorage` (LocalStorage, IndexedDB,
  Cloudflare KV, ...).
- **Search panel UI included** — wired through CodeMirror 6's
  `search` extension with localized labels, ARIA-friendly tooltips,
  and CSS Highlight integration for table-cell results.

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
  initialValue: "# Hello\n\nWelcome to Nexus.",
  plugins: [createSearchPlugin({ top: true })]
});
```

## Pure-function search

The package ships two framework-free helpers for use in build
scripts, server-side jobs, or anywhere you have a string and want
matches back:

```ts
import {
  findSearchMatches,
  replaceAllMatches
} from "@floatboat/nexus-plugin-search";

findSearchMatches("hello world", "world");
// → [{ from: 6, to: 11, text: "world" }]

findSearchMatches("Hello world", "world", { caseSensitive: true });
// → []

replaceAllMatches("foo bar foo", "foo", "baz");
// → "baz bar baz"
```

### Options

`findSearchMatches`, `replaceAllMatches`, and the search panel share
one `SearchOptions` shape:

| Option | Default | Notes |
|---|---|---|
| `caseSensitive` | `false` | Forwarded to both regex and fuzzy matchers. |
| `wholeWord` | `false` | Add `\b` boundaries around the pattern. |
| `regexp` | `false` | Treat the query as a JavaScript regex. |
| `fuzzy` | `false` | Subsequence matching. Ignores `regexp` and `wholeWord`. |
| `minScoreRatio` | `0` | Drop matches below this fraction of the theoretical best score. Only used when `fuzzy: true`. |

### Fuzzy matching

```ts
findSearchMatches("hello world", "hw", { fuzzy: true });
// → [{ from: 0, to: 7, text: "hello w" }]

findSearchMatches("Hello World", "HW", {
  fuzzy: true,
  caseSensitive: true
});
// → [{ from: 0, to: 7, text: "Hello W" }]

replaceAllMatches("hello world", "hw", "FOO", { fuzzy: true });
// → "FOOorld"
```

The fuzzy matcher is a per-line dynamic-programming scorer that
rewards:

- **Consecutive runs** (5 / character) — `hel` beats `h_e_l` on
  matching `hello`.
- **Word boundaries** (8 / character) — `hw` against `hello w`
  scores higher than against `xxhwyy`.
- **CamelCase transitions** (4 / character) — `fb` against
  `fooBar` gets a bonus at the `B`.
- **Short jumps** (3 / character) — `cl` against `Color` scores
  better than `c` against `ccccccccColor`.

Long jumps and gaps cost 1 + 2 respectively. Pass `minScoreRatio: 1`
to keep only perfect matches.

## Plugin options

`createSearchPlugin` returns a `NexusPlugin` and configures the
bundled search panel:

| Option | Default | Notes |
|---|---|---|
| `top` | `true` | Render the panel above the editor. |
| `caseSensitive` | `false` | Initial value for the case-sensitive toggle. |
| `highlightSelectionMatches` | `true` | Highlight matches of the current selection. |
| `history` | `false` | `true` for in-memory history, or pass `{ storage, storageKey, maxEntries }`. |
| `labels` | English | Override any visible string (see [Internationalisation](#internationalisation)). |

## Internationalisation

Every label the search panel renders can be overridden:

```ts
createSearchPlugin({
  labels: {
    find: "查找",
    replace: "替换",
    next: "下一处",
    previous: "上一处",
    all: "全部",
    matchCase: "区分大小写",
    regexp: "正则",
    byWord: "全字匹配",
    replaceNext: "替换",
    replaceAll: "全部替换",
    close: "关闭"
  }
});
```

## How the algorithm compares to other fuzzy finders

`fzf` and `fzy` score character transitions rather than requiring
a per-line "first" position; this implementation is simpler (one
match per line, subsequence not subsequence-of-any-window) and
sufficient for editor-side search. If you need richer semantics
(non-contiguous across lines, edit-distance fallback, debounced
incremental search across the whole document), file a feature
request with a use case.

## License

MIT
