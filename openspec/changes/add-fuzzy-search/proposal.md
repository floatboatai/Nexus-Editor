# Change: Add fuzzy search support

## Why

The search plugin currently performs literal/regexp matching, which makes symbol-style queries such as `csp` unable to discover `CreateSearchPlugin`. A fuzzy mode improves navigation in long markdown documents without changing the existing literal search behavior.

## What Changes

- Add a standalone fuzzy subsequence matcher to `@floatboat/nexus-plugin-search/fuzzy`.
- Rank matches using word-boundary bonuses, contiguous-character bonuses, and gap penalties.
- Return both the enclosing source range and the individual matched character offsets.
- Expose fuzzy matching through the Electron demo search bar with an explicit toggle.
- Disable replacement controls while fuzzy mode is active because a fuzzy match does not define a literal replacement target.

## Non-Goals

- Do not change the existing CodeMirror search panel semantics.
- Do not make fuzzy matching the default search mode.
- Do not provide fuzzy replacement semantics.
- Do not persist fuzzy-mode state across sessions.

## Impact

- Affected code: `packages/plugin-search`, `apps/electron-demo/src/renderer/search-bar.ts`.
- No breaking changes to the existing `createSearchPlugin()` API.
- The fuzzy matcher is opt-in and available as a separate package subpath.
