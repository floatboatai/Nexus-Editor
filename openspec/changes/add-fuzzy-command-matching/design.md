## Context

`filterSlashCommands` (in `packages/core/src/slash-state.ts`) ranks candidates in fixed tiers, with a documented rule that a higher tier always wins: exact title → title prefix → exact keyword → title substring → keyword prefix → keyword substring. Every tier is a *literal* match, so a query that is not a contiguous substring of the title or a keyword returns nothing.

The reviewer-facing questions for this change are:

1. Where should the matcher live, and what is its public contract?
2. How is alignment quality defined, so ranking is explainable and testable?
3. How does fuzzy matching stay additive instead of silently reshuffling existing results?

## Goals / Non-Goals

- Goals:
  - A pure, dependency-free, deterministic matcher usable by the slash menu today and by host-owned palettes/quick switchers tomorrow.
  - Ranking that degrades gracefully: literal hits always outrank fuzzy hits.
  - Match positions precise enough for a menu to highlight without re-parsing text.
- Non-Goals:
  - Fuzzy *document* search. In-document results are positional; ranking them by score would fight the `Search Next` contract.
  - Typo tolerance (edit distance). Subsequence matching plus scoring covers the palette use case; fuzzy-typo search is a different feature with a different cost profile.
  - Long-target throughput. Candidates are titles, keywords, file names — not whole documents.

## Decisions

### Decision: matcher lives in `@floatboat/nexus-core`, not in a plugin

The slash menu's ranker lives in core (`slash-state.ts` is exported from `@floatboat/nexus-core` and merely re-exported by `plugin-slash`), so the matcher has to live in core to be used without a plugin→plugin dependency. It is a pure string utility with no CodeMirror coupling, which matches how core already exports `computeSlashState`, TOC extraction and Markdown export.

*Alternatives considered:* putting it in `plugin-search` (the roadmap row's nominal owner) would force `core` to depend on a plugin for a core-internal ranker; duplicating the matcher in both packages was rejected outright.

### Decision: optimal alignment via dynamic programming, with a bounded fallback

The matcher aligns every query character to a distinct target character in order and maximises the total score. Greedy ("first match wins") alignment is cheap but picks the wrong alignment for inputs like `ab` against `a-b ab`, where the contiguous, word-start alignment at the end is clearly better. The DP runs in `O(query × target)` time with a prefix-maximum transition for the gap branch; targets longer than `MAX_OPTIMAL_ALIGNMENT_TARGET` (512 characters) fall back to a scored greedy alignment so cost stays bounded on pathological input.

Scoring weights (all additive, integers, so ordering is deterministic and reproducible):

| Signal | Weight | Rationale |
|---|---|---|
| Base per matched character | `+16` | A match must be able to pay for the characters it skips |
| Match at target start | `+10` | Prefix hits are what users usually mean |
| Match at a word start / after a separator / after a second script | `+8` | `tbl` should prefer **Table** over **Bat·t·le**-style mid-word hits |
| camelCase hump | `+7` | `gc` should find **getContent** |
| Adjacent to the previous match | `+8` per pair | Contiguous runs beat scattered alignments |
| Exact-case match (case-insensitive mode) | `+1` | Tie-break `H` toward `Heading` over `heading` |
| First skipped character in a gap | `−3` | Starting a gap is worse than extending it |
| Each further skipped character | `−1` | Longer gaps are worse than shorter ones |
| Leading gap before the first match | same gap rule | Earlier matches rank higher |

*Alternatives considered:* a hand-rolled regex (`/t.*b.*l/`) cannot rank; `fzf`-style streak-scaling bonuses add a second DP dimension for marginal ordering benefit and are deliberately out of scope (documented in `fuzzy-match.ts`).

### Decision: fuzzy is a new lowest tier, never an override

Existing tiers keep their scores and tiebreakers untouched; fuzzy results are inserted below `SCORE_KEYWORD_SUBSTRING` and clamped into a 1000-point band (`SCORE_FUZZY_CEILING`). A command that matches literally therefore outranks one that only aligns fuzzily, and a list that previously matched entirely literally returns the identical order — the change is additive by construction, which is what the existing "higher tier wins regardless of secondary tiebreaker" comment promises.

*Trade-off:* a strong fuzzy hit can never outrank a weak literal hit. That is intentional: literal containment is a stronger signal than subsequence containment.

### Decision: positions are UTF-16 code-unit offsets into the original target

Callers are rendering `title.slice(...)` / `Range`-style highlighting, so positions are code-unit offsets that can be used directly. Matching walks code points, so an emoji or other astral character counts as one query character and never produces a half-surrogate highlight.

### Decision: the menu highlights only the title it renders

`rankSlashCommands` reports the winning field (`title` or `keyword`) plus the matched field text. `createSlashMenuUI` highlights the title when the title produced the win and renders plain text when only a keyword matched, because the keyword is not part of the rendered item. Hosts that render keywords can still use the ranking data directly.

## Risks / Trade-offs

- **Fuzzy noise:** every command whose title contains the query characters in order now appears. Mitigation: fuzzy sits below all literal tiers, and the menu is capped by `slashMenuLimit` (default 8) after ranking.
- **DP cost on long candidates:** bounded by the 512-character optimal cap; beyond it the greedy path is `O(target)`.
- **Highlight drift:** the menu re-ranks the ≤`limit` visible commands to obtain positions. Mitigation: positions are re-validated against the title length before they reach the DOM, and a test covers query changes clearing stale marks.

## Migration Plan

None required — the change is additive. `filterSlashCommands(commands, query)` keeps its signature, `computeSlashState` keeps its shape, and hosts that render their own menu gain an opt-in `rankSlashCommands` export.

## Open Questions

- Should the extended `SlashCommandDef` gain an explicit `boost` field so hosts can force a command (e.g. "most used") above the fuzzy band? Deferred: recency reordering already exists opt-in in `plugin-slash`.
