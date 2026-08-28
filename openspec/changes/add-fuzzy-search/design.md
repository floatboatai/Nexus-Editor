# Design: Fuzzy Search Matching

## Context

`plugin-search` currently exposes three matching paths: literal (escaped), regexp, and whole-word variants of both, all compiled by `buildSearchPattern` into a single `RegExp` used by `findSearchMatches` and `replaceAllMatches`. Fuzzy matching cannot be expressed as a `RegExp`, so it needs a dedicated matcher and a routing decision in the two public helpers.

Two consumers exist: the CodeMirror search panel (regex-based CM6 engine — untouched by this change) and hosts using the exported helpers directly (e.g. `apps/electron-demo/src/renderer/search-bar.ts`).

## Goals / Non-Goals

- Goals: opt-in fuzzy mode for the exported helpers, fzf-style ranking, precise per-character match info for highlighting, literal replacement, zero new dependencies, fully deterministic output.
- Non-Goals (see proposal): CM6 panel toggle, demo search-bar wiring, plugin-slash fuzzy, third-party dependency.

## Decisions

### Decision 1: Hand-written fzf-style matcher instead of a third-party library

Roadmap #17 explicitly asks to evaluate "fzf-like algorithm vs. third-party lib".

Considered alternatives:

- **fzf-for-js / fzy.js ports**: small and unmaintained; their scoring models are tuned for file-path and command palettes (heavy bonuses for path separators and directory boundaries), which is the wrong profile for prose and Markdown text.
- **`fuzzy-search` / `fuzzysort`-style npm packages**: additional runtime dependency for roughly a hundred lines of well-understood algorithm; `plugin-search` currently depends only on workspace packages and CodeMirror, and the repository favors small, testable, single-purpose modules.

Decision: implement the matcher in-repo (`src/fuzzy-matcher.ts`, internal module). It keeps the dependency graph unchanged, gives us full control over the scoring profile (tuned for prose, not paths), and makes the behavior fully deterministic and unit-testable. The evaluation result is recorded here as the roadmap note requested.

### Decision 2: Memoized backtracking DP, O(n·m)

A fzf-style "greedy forward with restart" heuristic is fast but has no clean worst-case bound and complicates determinism arguments. Instead:

- State: `best(docIdx, queryIdx)` = highest score obtainable by matching `query[queryIdx..]` against `doc[docIdx..]`, with the matched positions.
- Transition: match `doc[docIdx]` against `query[queryIdx]` (if equal under the case rule) and recurse, or skip `doc[docIdx]` and recurse. On equal total score, prefer matching — it yields the tightest span.
- The memo is shared across all candidate start positions, so the total work is O(n·m) with O(n·m) worst-case memory (query length m is a few characters in practice; editor documents are typically far below the size where this matters).

The gap penalty (-1 per skipped character) makes "skip then match" naturally costlier than matching early, which is exactly fzf's ranking behavior.

### Decision 3: Scoring model (fzf-inspired, simplified)

Constants (documented in code):

| Component | Value | Condition |
|---|---|---|
| Base | +1 | per matched character |
| Word start | +8 | document start, or previous character is not alphanumeric |
| camelCase | +4 | previous character is a lowercase letter and the matched character is uppercase |
| Consecutive | +4 | matched character immediately follows the previous matched character |
| Gap | -1 | per unmatched character between matched characters |

Bonus detection runs on the raw document characters (structure, not case folding); character equality is case-folded when `caseSensitive` is false. This mirrors fzf's boundary/camel/consecutive bonus family but drops the path-separator bias, which is irrelevant for prose.

### Decision 4: Fuzzy takes precedence over `regexp` and `wholeWord`

Options may arrive from persisted host configuration, and combinations like `{fuzzy: true, regexp: true}` are possible. Alternatives considered:

- **Reject conflicting combinations**: adds an error path for a condition that is not a user bug in practice, and diverges from how `regexp` + `wholeWord` already compose silently.
- **Precedence with documentation**: fuzzy mode matches the query as literal characters (regex metacharacters like `.` or `*` are literal), and `wholeWord` is ignored because a subsequence match has no well-defined word boundary. `caseSensitive` still applies. This matches user expectation ("I asked for fuzzy, so fuzzy it is") and keeps the API total.

Decision: documented precedence, no error path. `regexp` and `wholeWord` remain fully functional in non-fuzzy mode; behavior when `fuzzy` is absent or `false` is unchanged bit-for-bit.

### Decision 5: Additive `segments` field on `SearchMatch`

A fuzzy match covers a span that includes skipped characters (e.g. `fzs` matches the whole of `fuzzy search`). Highlighting the entire span would paint unmatched characters as matched. Adding `segments?: ReadonlyArray<{from: number; to: number}>` (contiguous runs of matched positions, `to` exclusive) lets hosts highlight precisely. It is additive: existing consumers that ignore it keep working, and non-fuzzy matches may omit it.

### Decision 6: Score-first ordering, document-order tiebreak

Non-fuzzy mode returns matches in document order, which is what the existing search-bar "nearest match to cursor" logic assumes. Fuzzy mode returns matches sorted by score descending, with document order (`from` ascending) as a stable tiebreak — ranking is the entire point of fuzzy search. The ordering contract is stated in the spec so hosts consuming fuzzy results sort-aware; hosts that do not enable `fuzzy` never observe a change.

Overlapping matches (same character matched by different start positions, e.g. `ana` in `banana`) are allowed and each appears once per start position — the DP yields exactly one best match per start.

### Decision 7: Literal replacement over the full matched span

`replaceAllMatches` in fuzzy mode replaces each match's `[from, to)` span (first to last matched character) with the replacement string verbatim, applied in reverse document order in a single pass. There is no `$1`-style group substitution in fuzzy mode because fuzzy matches have no capture groups; the replacement is always literal.

## Risks / Trade-offs

- **Ranking divergence from fzf**: the scoring profile is a simplified fzf. The weights are documented constants and the ranking is deterministic, so behavior is reproducible in tests; tuning is a data-driven follow-up if hosts report poor rankings.
- **O(n·m) worst case**: acceptable — query strings are short, and the memo keeps the per-document cost linear in document size. Regex mode has no such bound either.
- **CM6 panel gap**: the panel still runs CM6's regex engine, so panel users do not get fuzzy ranking yet. This is an explicit non-goal and the follow-up work is scoped in the proposal.
