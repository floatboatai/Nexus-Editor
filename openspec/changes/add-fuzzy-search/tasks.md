# Tasks: Add fuzzy (subsequence) search

## 1. Core fuzzy matcher

- [x] Add `packages/core/src/fuzzy.ts` with `fuzzyMatch` (O(m·n) DP + backtracking
      to recover matched offsets, boundary / camelCase / consecutive / gap /
      leading penalties) and `fuzzyFilter`.
- [x] Export `fuzzyMatch`, `fuzzyFilter` (and their types) from
      `packages/core/src/index.ts`.
- [x] Add `packages/core/test/fuzzy.test.ts` covering: no-match, case
      sensitivity, contiguous vs spread ranking, boundary bonus, gap penalty,
      and optimal (non-greedy) alignment.

## 2. Slash menu fuzzy tier

- [x] In `packages/core/src/slash-state.ts`, add a lowest-priority fuzzy tier to
      `filterSlashCommands` so subsequence matches rank below prefix /
      substring / keyword hits.
- [x] Extend `packages/core/test/slash-state.test.ts` with fuzzy-ranking cases
      (subsequence surfaced only when no stronger tier matches; prefix beats
      fuzzy).

## 3. Search plugin fuzzy support

- [x] Add `fuzzy?: boolean` to `SearchOptions` in
      `packages/plugin-search/src/index.ts`.
- [x] Implement per-line fuzzy `findSearchMatches` / `replaceAllMatches`
      (literal fallback when `fuzzy` is absent; fuzzy ignored when `regexp` is
      set).
- [x] Add `packages/plugin-search/src/fuzzy-search-extension.ts` with a CM6
      `StateField` + decoration `ViewPlugin` for live highlight, plus
      `nexusFuzzyNavigate` / `nexusFuzzySelectAll` commands and `setFuzzyQuery`
      effect. Enable `EditorState.allowMultipleSelections` so "All" works.
- [x] Wire a "Fuzzy" checkbox into `NexusSearchPanel`; mirror the query into the
      fuzzy state and route Next/Prev/All through the fuzzy commands when
      checked.
- [x] Add `@codemirror/state` to `devDependencies` (needed by the test).
- [x] Extend `packages/plugin-search/test/plugin-search.test.ts`:
      - programmatic API: per-line matches, no-match, case sensitivity,
        char-only replace, literal fallback, regexp-over-fuzzy.
      - extension: highlight marks, navigate selection, multi-range select-all,
        clearing on null query.

## 4. Specs & docs

- [x] Add `specs/editor-core/spec.md` (fuzzyMatch / fuzzyFilter requirements).
- [x] Add `specs/plugin-search/spec.md` (fuzzy search option + in-editor
      highlight/navigation requirements).
- [x] Disclose AI assistance in the PR description per `GOVERNANCE.md §6.2`.
