# Change: Add fuzzy search to plugin-search

## Why
The existing regexp/whole-word/case-sensitive options require typing exact
substrings. Users who mis-type or only remember fragments of a word get zero
results. Fuzzy matching (fzf-style character-order matching) lets users find
"hello" by typing "hlo", dramatically improving search UX.

## What Changes
- Add `fuzzy` option to `SearchOptions` and `SearchPluginOptions`
- Implement zero-dependency fuzzy matching that scores and converts a user
  query into a CodeMirror-compatible `RegExp`
- Add a "Fuzzy" checkbox toggle to the search-panel UI (alongside match-case /
  regexp / whole-word)
- Public API: `buildFuzzyPattern(query: string, options?: SearchOptions): RegExp | null`
- Public API: `fuzzyScore(query: string, candidate: string): number`
- When `fuzzy` is on, `regexp` and `wholeWord` are ignored (mutually exclusive)

## Impact
- Affected specs: `search`
- Affected code: `packages/plugin-search/src/index.ts`,
  `packages/plugin-search/test/`
- No breaking changes — `fuzzy` defaults to `false`
- Zero new runtime dependencies
