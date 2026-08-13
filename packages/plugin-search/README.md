# @floatboat/nexus-plugin-search

Find & replace for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor),
built on `@codemirror/search`:

- **Search panel UI** — case, regexp, and whole-word toggles, next /
  previous / select-all, and an optional replace row.
- **Unicode-aware whole-word matching** — word boundaries are computed
  from Unicode letter, mark, and number categories, not ASCII `\b`.
- **Pure matching functions** — `findSearchMatches` and
  `replaceAllMatches` work on a plain string, independent of the editor
  or the panel UI.
- **Opt-in query history** — host-supplied storage, no implicit
  `localStorage` access.

## Install

```bash
pnpm add @floatboat/nexus-plugin-search @floatboat/nexus-core
```

## Quick start

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const editor = createEditor({
  container,
  plugins: [
    createSearchPlugin({
      history: true // opt in to in-memory query history
    })
  ]
});

// Cmd/Ctrl+F opens the panel via the bundled keymap.
```

## Standalone use

`findSearchMatches` and `replaceAllMatches` don't need an editor
instance — they operate on a plain string and the same
`SearchOptions` the panel UI produces:

```ts
import { findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

findSearchMatches("你好，世界！", "世界", { wholeWord: true });
// [{ from: 3, to: 5, text: "世界" }]

replaceAllMatches("cat catalog cat", "cat", "dog", { wholeWord: true });
// "dog catalog dog" -> the "cat" inside "catalog" is left untouched
```

## Whole-word matching semantics

Plain `\b` in JavaScript regular expressions is defined in terms of
ASCII `\w`, so it does not recognize boundaries around CJK, Cyrillic,
accented letters, or combining marks. `wholeWord: true` instead treats
any Unicode letter, combining mark, number, or underscore as a word
character:

```text
[\p{L}\p{M}\p{N}_]
```

A match is a whole word when neither the character immediately before
it nor the character immediately after it is a word character.
Document boundaries, whitespace, punctuation, symbols, and emoji all
count as boundaries.

| Document | Query | Result |
|---|---|---|
| `你好，世界！` | `世界` | match |
| `你好世界和平` | `世界` | no match — inside uninterrupted CJK text |
| `café noir` | `café` | match |
| `decaféine` | `café` | no match — substring of a longer word |
| `Привет, мир` | `Привет` | match |
| `한글 문서` | `한글` | match |
| `item_1 item` | `item` | matches only the standalone occurrence |

This is deterministic code-point boundary detection, not
dictionary-based word segmentation — a query inside uninterrupted CJK
text is never treated as a whole word, by design.

The bundled search panel delegates whole-word navigation to CodeMirror's
built-in `SearchQuery.wholeWord` character categorizer. The Unicode rules
above apply to `findSearchMatches` and `replaceAllMatches`.

### Regexp compatibility constraint

`wholeWord` puts the entire query in Unicode mode (the `u` flag) so
the boundary assertions above are interpreted correctly. This is only
added when `wholeWord` is enabled; plain searches keep their existing
flags and behavior. Two consequences when combining `regexp: true`
with `wholeWord: true`:

- Legacy non-Unicode escape sequences (e.g. `\a`) that are valid
  without the `u` flag become invalid with it.
- Case-insensitive matching uses Unicode case folding instead of
  ASCII-only folding.

An invalid pattern — whether invalid on its own or only once the `u`
flag applies — is never silently "fixed" by the whole-word wrapping.
`findSearchMatches` returns `[]` and `replaceAllMatches` returns the
original document unchanged, the same contract as any other invalid
regexp query.

### Replacement templates

`findSearchMatches` and `replaceAllMatches` share one compiled
pattern, so whole-word matching never drifts from whole-word
replacement. Capture groups and native replacement templates (`$1`,
`$&`, …) work the same with `wholeWord: true` as without it, because
the boundary assertions are added as non-capturing lookaround and
never renumber the query's own groups.

## API

| Export | Purpose |
|---|---|
| `createSearchPlugin(options?)` | Wraps CodeMirror's search extension as a `NexusPlugin` with a labeled, `data-test-id`-annotated panel. |
| `findSearchMatches(doc, query, options?)` | Returns every match as `{ from, to, text }`. |
| `replaceAllMatches(doc, query, replacement, options?)` | Returns a new document with every match replaced. |
| `SearchOptions` | `{ caseSensitive?, wholeWord?, regexp? }` |
| `SearchMatch` | `{ from: number, to: number, text: string }` |
| `SearchPluginOptions` | `{ top?, caseSensitive?, highlightSelectionMatches?, history?, labels? }` |
| `SearchPluginLabels` | Overridable panel copy (`find`, `replace`, `matchCase`, `byWord`, …) for i18n. |
| `SearchHistoryOptions` | `{ storage?, storageKey?, maxEntries? }` — pass `history: true` for in-memory-only history, or supply `storage` to persist it. |

## License

MIT
