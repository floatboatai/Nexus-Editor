# @floatboat/nexus-plugin-search

Search & replace for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor) —
an accessible CodeMirror 6 search panel plus a set of pure, editor-independent
matching utilities.

- **Drop-in panel** — `createSearchPlugin()` wires up `Cmd/Ctrl-F` with a
  headless, ARIA-labelled find/replace UI (case, regexp, whole-word toggles).
- **Search query history** — opt-in, host-injected storage (no implicit
  `localStorage`); recall with `ArrowUp` / `ArrowDown`.
- **Pure matching utilities** — `findSearchMatches` / `replaceAllMatches` run on
  a plain string, so hosts can build their own search UI, count matches, or
  batch-replace without mounting the panel.
- **fzf-style fuzzy matching** — `fuzzyMatch` / `findFuzzyMatches` for
  quick-open, symbol pickers, and command palettes.

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
  initialValue: "# Hello\n\nStart typing...",
  plugins: [
    createSearchPlugin({
      top: true,
      highlightSelectionMatches: true,
      history: true // opt-in; pass { storage } to persist
    })
  ]
});
```

Press `Cmd/Ctrl-F` to open the panel. `createSearchPlugin` returns a
`NexusPlugin` — pass it straight to `createEditor`.

### Panel options

| Option | Default | Notes |
|---|---|---|
| `top` | `true` | Render the panel above the content (vs. below). |
| `caseSensitive` | `false` | Initial state of the case toggle. |
| `highlightSelectionMatches` | `true` | Highlight other occurrences of the current selection. |
| `history` | `false` | `true` enables in-memory history; `{ storage, storageKey?, maxEntries? }` persists it. |
| `labels` | English | Override any panel string (i18n). |

## Matching utilities

These are plain functions over a string — no editor instance required.

### `findSearchMatches(doc, query, options?): SearchMatch[]`

Exact / regexp / whole-word matching. Returns every match as
`{ from, to, text }`. Invalid regular expressions return `[]` rather than
throwing.

```ts
import { findSearchMatches } from "@floatboat/nexus-plugin-search";

findSearchMatches("foo bar Foo", "foo", { caseSensitive: false });
// [{ from: 0, to: 3, text: "foo" }, { from: 8, to: 11, text: "Foo" }]

findSearchMatches("v1 and v2", "v\\d", { regexp: true });
// [{ from: 0, to: 2, text: "v1" }, { from: 7, to: 9, text: "v2" }]
```

### `replaceAllMatches(doc, query, replacement, options?): string`

Returns a new document with every match replaced. `SearchOptions` are shared
with `findSearchMatches`: `{ caseSensitive?, wholeWord?, regexp? }`.

## Fuzzy matching

Fuzzy matching answers a different question than exact search: *does the query
appear in the text in order, allowing gaps?* This is the model behind editor
quick-open, symbol pickers, and command palettes — type `fzm` and match
`f`uz`z`y`M`atch.

### `fuzzyMatch(text, query, options?): FuzzyMatchResult | null`

Scores a single candidate. Returns `null` when `query` is not a subsequence of
`text`, otherwise `{ score, positions }` where `positions` are the indices of
each matched character (ascending). Higher scores are better matches; scores are
only meaningful relative to each other.

```ts
import { fuzzyMatch } from "@floatboat/nexus-plugin-search";

fuzzyMatch("live-preview-table.ts", "lpt");
// { score: 65, positions: [0, 5, 13] }  ← l(ive) p(review) t(able)

fuzzyMatch("hello", "world");
// null
```

An empty query is a zero-score match (`{ score: 0, positions: [] }`). Matching is
case-insensitive unless `{ caseSensitive: true }` is passed.

### `findFuzzyMatches(doc, query, options?): FuzzyMatch[]`

Fuzzy-searches a document line by line and returns the matching lines ranked
best-first. Each `FuzzyMatch` carries **absolute document offsets** so the
result can drive a highlight decoration or a "jump to match":

```ts
interface FuzzyMatch {
  from: number;      // offset of the first matched char
  to: number;        // offset just past the last matched char
  text: string;      // full text of the matched line
  line: number;      // zero-based line index
  score: number;
  positions: number[]; // absolute offset of each matched char
}
```

```ts
import { findFuzzyMatches } from "@floatboat/nexus-plugin-search";

const doc = editor.getDocument();
for (const match of findFuzzyMatches(doc, "todo")) {
  console.log(`line ${match.line}: ${match.text} (score ${match.score})`);
}
```

An empty query returns `[]` (matching `findSearchMatches`), not every line.

### Scoring model

The scorer follows fzf's `FuzzyMatchV1`: a forward + backward scan narrows the
text to the shortest window that still contains the query, then a single linear
pass scores it. Ranking is shaped by:

| Signal | Effect |
|---|---|
| Contiguous run | Adjacent matched characters score higher than scattered ones. |
| Word boundary | Matching the start of a word (after whitespace / `-`, `_`, `/`, `.`) is rewarded. |
| camelCase / number boundary | `fooBar` matches `fb` strongly; `v2` rewards the `2`. |
| First character | Boundary bonuses count double on the query's first character. |
| Gaps | Unmatched characters between matches are penalized (gap-open + gap-extend). |

### Limits

- **Line-scoped.** `findFuzzyMatches` matches within a single line — a fuzzy
  match never spans a newline. This keeps results and offsets meaningful for an
  editor.
- **Not wired into the `Cmd/Ctrl-F` panel.** `@codemirror/search` has no fuzzy
  mode, and grafting one in is a separate concern. Fuzzy matching ships as a
  utility so hosts can build a dedicated finder (quick-open dialog, command
  palette) on top of it.
- Offsets are UTF-16 code-unit indices, consistent with CodeMirror document
  positions.

## License

MIT
