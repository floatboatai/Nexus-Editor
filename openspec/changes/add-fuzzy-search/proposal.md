# Change: Add Fuzzy Search Matching

## Why

Roadmap #17 ("Fuzzy search", `plugin-search`, P2) calls for a fuzzy matching mode: users should be able to find content by typing a subsequence of the target text (for example `fzs` → `fuzzy search`) instead of an exact substring. Today `buildSearchPattern` only compiles literal or regular-expression patterns, so every character must appear in the document in order and adjacent. The roadmap note prescribes the shape of the work: "Evaluate fzf-like algorithm vs. third-party lib; needs backtracking matcher".

## What Changes

- Add an opt-in `fuzzy` flag to `SearchOptions` for `findSearchMatches()` and `replaceAllMatches()`.
- Implement a hand-written, fzf-style scoring matcher (memoized backtracking DP) with no new dependencies.
- Rank fuzzy matches by score (word-start, camelCase, and consecutive-match bonuses; gap penalty), with a deterministic document-order tiebreak.
- Expose the exact matched character ranges via an additive, optional `segments` field on `SearchMatch` so hosts can highlight matched characters precisely.
- Support literal replacement across the full matched span in fuzzy mode.
- Document precedence: `fuzzy` takes precedence over `regexp` and `wholeWord`; `caseSensitive` applies.
- Preserve existing search behavior bit-for-bit when `fuzzy` is not enabled.

## Non-Goals

- No fuzzy toggle in the CodeMirror search panel (the CM6 search engine is regex/literal-based; panel integration needs engine-level work and is a follow-up).
- No Electron demo search-bar wiring in this PR.
- No fuzzy matching for `plugin-slash` commands.
- No third-party fuzzy-search dependency.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-search/src/fuzzy-matcher.ts` (new, internal)
  - `packages/plugin-search/src/index.ts`
  - `packages/plugin-search/test/plugin-search.test.ts`
- Affected roadmap: completes Roadmap #17 (`plugin-search` fuzzy search).
