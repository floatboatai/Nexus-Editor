# Change: Add Fuzzy Search Mode

## Why

Roadmap item #17 calls for fuzzy search in `@floatboat/nexus-plugin-search`.
The current plugin only performs literal CodeMirror search, which requires
users to type the exact contiguous text they want to find.

This change adds an ordered-subsequence search mode so short queries such as
`nxe` can locate text such as `Nexus Editor` while keeping the existing search
panel and keyboard navigation workflow.

## What Changes

- `@floatboat/nexus-plugin-search` exports fuzzy helpers:
  - `findFuzzySearchMatches(doc, query, options?)`
  - `createFuzzySearchPattern(query)`
  - `FuzzySearchMatch`
- `findSearchMatches(doc, query, { fuzzy: true })` delegates to the fuzzy
  matcher while retaining the existing literal behaviour by default.
- `createSearchPlugin({ fuzzy: true })` enables fuzzy mode by default in the
  search panel.
- The search panel gains a `Fuzzy` checkbox. When enabled, the panel compiles
  the raw query to a safe line-local regexp for CodeMirror navigation while the
  input continues to display the user's original query.
- Documentation, roadmap entries, demo vault content, and tests are updated.

No breaking changes: fuzzy mode is opt-in and existing search options keep
their current defaults.

## Impact

- Affected specs:
  - `plugins` (ADDED: fuzzy search mode for `@floatboat/nexus-plugin-search`)
- Affected code:
  - `packages/plugin-search/src/index.ts`
  - `packages/plugin-search/test/plugin-search.test.ts`
  - `packages/plugin-search/README.md`
  - `apps/electron-demo/sample-vault/fuzzy-demo.md`
  - `apps/electron-demo/sample-vault/index.md`
  - `docs/ROADMAP.md`
  - `docs/ROADMAP.zh.md`
- New dependencies: none.
- Out of scope:
  - Fuzzy result ranking UI beyond the helper `score` metadata.
  - Per-character fuzzy highlight decoration in the editor viewport.
  - Persistent search history.
