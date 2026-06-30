# Change: Add Fuzzy Search Helpers

## Why

Roadmap #17 calls for fuzzy search in `@floatboat/nexus-plugin-search`. Exact, whole-word, and regex search work well when users know the precise text, but note-taking workflows often need quick subsequence lookup across headings, filenames, and prose where the user remembers only initials or partial characters.

## What Changes

- Add opt-in fuzzy matching to `findSearchMatches()` via `SearchOptions.fuzzy`.
- Return fuzzy match metadata with ranking `score` and contiguous `ranges` for UI highlighting.
- Support score-first or document-order sorting through `SearchOptions.sortBy`.
- Support `maxMatches` capping after sorting.
- Preserve existing exact, whole-word, regex, replace, and CodeMirror search panel behavior by default.
- Add fuzzy span replacement to `replaceAllMatches()` for hosts that use the helper outside the CodeMirror panel.
- Add a fuzzy toggle to the Electron demo search bar to demonstrate the helper in a visible integration surface.

## Non-Goals

- No third-party fuzzy-search dependency.
- No CodeMirror search panel fuzzy mode in this PR; CodeMirror's native panel remains exact/regex-oriented.
- No cross-file vault search UI.
- No changes to `packages/core` search or selection APIs.

## Impact

- Affected specs: `plugins`
- Affected roadmap: Roadmap #17 (`Fuzzy search`)
- Affected code:
  - `packages/plugin-search/src/index.ts`
  - `packages/plugin-search/test/plugin-search.test.ts`
  - `packages/plugin-search/README.md`
  - `apps/electron-demo/src/renderer/search-bar.ts`
  - `docs/ROADMAP.md`
