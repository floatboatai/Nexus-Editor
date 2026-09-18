## 1. OpenSpec and Scope

- [x] 1.1 Create OpenSpec change `add-search-fuzzy`.
- [x] 1.2 Define line-scoped subsequence matching and score semantics.
- [x] 1.3 Record non-goals: ranked navigation, cross-line matching, typo tolerance, third-party libraries.

## 2. Red Tests Before Implementation

- [x] 2.1 Add matcher tests for subsequence hits, per-line scope, and document order.
- [x] 2.2 Add matcher tests for case-sensitive and case-insensitive behavior.
- [x] 2.3 Add scoring tests comparing boundary, consecutive, gap, and case-folded matches.
- [x] 2.4 Add edge-case tests: blank query, empty document, query longer than a line, CRLF line endings.
- [x] 2.5 Add tests proving non-fuzzy results keep their existing shape and order.
- [x] 2.6 Add panel tests for the fuzzy toggle, label localization, and option exclusivity.
- [x] 2.7 Add panel tests for navigation, select-all, replace hiding, and history recall.

## 3. Fuzzy Matcher

- [x] 3.1 Implement a line-scoped subsequence matcher with a minimal-span alignment.
- [x] 3.2 Implement the fzf-inspired score: match, boundary, camelCase, consecutive, gap penalty, exact-case bonus.
- [x] 3.3 Surface matches through `findSearchMatches()` with document-order ranges and scores.
- [x] 3.4 Make `replaceAllMatches()` treat `fuzzy` as a find-only option.

## 4. CodeMirror Integration

- [x] 4.1 Add `FuzzySearchQuery` with fuzzy-aware equality and a fuzzy match cursor.
- [x] 4.2 Add the fuzzy query type implementing `nextMatch`, `prevMatch`, `matchAll`, `highlight`, and `getReplacement`.
- [x] 4.3 Keep rendered table-cell search highlights on the fuzzy pipeline.

## 5. Panel UI

- [x] 5.1 Add the fuzzy toggle with a localized label.
- [x] 5.2 Enforce `fuzzy` mutual exclusion with `regexp` and `wholeWord`.
- [x] 5.3 Hide the replace toggle and row while fuzzy mode is active.
- [x] 5.4 Preserve case-sensitive, replace text, and history recall state across fuzzy toggling.

## 6. Documentation

- [x] 6.1 Mark Roadmap #17 as done in `docs/ROADMAP.md`.
- [x] 6.2 Mark Roadmap #17 as done in `docs/ROADMAP.zh.md`.

## 7. Verification

- [x] 7.1 Run the targeted `plugin-search` Vitest suite and confirm the new tests pass (58/58).
- [x] 7.2 Run the `plugin-search` TypeScript typecheck (clean).
- [x] 7.3 Run the full Vitest suite: 921 passed, 1 failed — the failure is the pre-existing Windows-only `plugin-host-broker` `O_NONBLOCK` assertion that also fails on `main` before this change.
- [x] 7.4 Run the `@floatboat/nexus-plugin-search` build (ESM + d.ts, clean).
