# Change: Add Fuzzy Search

## Why

Roadmap #17 ("Fuzzy search") calls for fzf-like matching in `@floatboat/nexus-plugin-search`. Today the search panel only supports literal, whole-word, and regular expression queries, so a query such as `fbb` cannot find `foo bar baz`. This change adds an opt-in fuzzy mode that matches subsequence queries and drives the existing navigation, selection, and highlighting pipeline without introducing a third-party matching library.

## What Changes

- Add an opt-in `fuzzy` mode to `SearchOptions` and to the search panel as a fourth toggle.
- Match the query as an ordered subsequence **within a single line**; a match spans from its first to its last matched character, so multi-character gaps stay inside the highlighted range.
- Score every match with an fzf-inspired heuristic: per-character base score, word-boundary and camelCase bonuses, consecutive-character bonus, and a penalty that grows with the length of unmatched gaps. Exact-case matches score higher than case-folded ones when case-insensitive matching is used.
- Return results in document order, unchanged from the literal and regexp paths, with the score attached as an optional field.
- Wire fuzzy mode into the CodeMirror search pipeline so `findNext`, `findPrevious`, `selectMatches`, viewport match highlighting, and rendered table-cell highlights all follow fuzzy matches.
- Make `fuzzy` mutually exclusive with `regexp` and `wholeWord` in the panel.
- Hide the replace toggle and replace row while fuzzy mode is active; fuzzy replace is not defined because a subsequence match can be any span of text.
- Localize the fuzzy toggle label through the existing `labels` option.
- Mark Roadmap #17 as done in `docs/ROADMAP.md` and `docs/ROADMAP.zh.md`.

## Non-Goals

- No ranked results list, result counter, or score-based navigation. The score is surfaced as data for follow-up work; jumps follow document order.
- No cross-line matching. Matching a query across a newline is left for a later change.
- No typo tolerance (fzf's `typos: false` behavior is out of scope for this PR).
- No third-party fuzzy library. The matcher is implemented in-package, keeping the dependency set unchanged.
- No changes to `@floatboat/nexus-plugin-slash`, `preset-gfm`, or the electron-demo search bar.
- No new runtime dependency. `@codemirror/state` is deliberately not declared as a direct dependency; editor state types are derived from `@codemirror/view`.

## Design Notes

- **Why a `SearchQuery` subclass.** The CodeMirror search pipeline resolves matches through `SearchQuery.create()`, which returns an internal query-type object consumed by `findNext`, `findPrevious`, `selectMatches`, the match highlighter, and replace commands. Literal and regexp queries cannot express a subsequence match, so fuzzy mode is implemented as a `SearchQuery` subclass that supplies its own query type. This keeps the fuzzy matcher on the same pipeline instead of re-implementing the panel, decorations, and table highlighting in parallel.
- **Why the query type protocol is hand-implemented.** `QueryType` is not exported by `@codemirror/search`; only the runtime shape (`nextMatch`, `prevMatch`, `matchAll`, `highlight`, `getReplacement`) is stable. The handler is therefore implemented against that shape and covered by integration tests that exercise the real commands.
- **Why matching is line-scoped.** Subsequence matching over an entire document makes match ranges arbitrarily long and unbounded in scan cost; per-line matching matches the way every fzf-style tool treats candidates, keeps ranges readable in the editor, and keeps the scan at O(document length × query length).
- **Why replace is disabled.** Replacing a fuzzy match span would delete or overwrite unrelated text (`fbb` → `foo bar b`). The toggle hides the replace UI, and the query type's replacement resolves to the matched text itself so a programmatically invoked replace command is a no-op rather than destructive.
- **Why results stay in document order.** The literal and regexp paths return matches in document order and the highlighting pipeline depends on that contract; reordering by score would change the observable behavior of every existing caller.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-search/src/index.ts`
  - `packages/plugin-search/test/plugin-search.test.ts`
- Affected docs: `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- Public API: additive only. `SearchOptions.fuzzy`, `SearchMatch.score`, `SearchPluginLabels.fuzzy`, and the exported `FuzzySearchQuery` class are new; no existing field is renamed, removed, or redefined.
- Affected roadmap: Roadmap #17 only. Undo/redo grouping (#8) and plugin event bus (#10) are untouched.
