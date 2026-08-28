## 1. Fuzzy matcher

- [x] 1.1 Add `src/fuzzy-matcher.ts` with the memoized backtracking DP matcher (documented scoring constants, deterministic tiebreaks, segment compression)
- [x] 1.2 Route `findSearchMatches` through the matcher when `SearchOptions.fuzzy` is set; expose `segments` on `SearchMatch` (additive field)
- [x] 1.3 Add the fuzzy path to `replaceAllMatches` (literal replacement over each match span, reverse order)
- [x] 1.4 Document the scoring model and option precedence in TSDoc comments

## 2. Tests

- [x] 2.1 Matcher unit tests: subsequence matching, word-start / camelCase / consecutive bonuses, gap penalty, caseSensitive, tightest-span tiebreak, segment compression
- [x] 2.2 API tests: fuzzy ranking with document-order tiebreak, segments on results, literal replacement, empty query, query longer than document, precedence over `regexp` and `wholeWord`
- [x] 2.3 Backward-compatibility tests: existing non-fuzzy suites remain green

## 3. Validation

- [x] 3.1 `openspec validate add-fuzzy-search --strict`
- [x] 3.2 `pnpm test` (plugin-search and electron-demo suites)
- [x] 3.3 `plugin-search` build and typecheck

## 4. Docs

- [x] 4.1 Update `docs/ROADMAP.md` #17 to done with a reference to this change
