# Proposal: Add fuzzy (subsequence) search

## Status

Proposed

## Context

`ROADMAP.md` lists **#17 Fuzzy search** (P2) as `planned` and describes it as
*"evaluate fzf-class algorithm, needs a backtracking matcher"*. Today the
search plugin only supports literal, whole-word, and regexp matching — and the
slash command menu only does prefix / substring / keyword ranking. For a
Markdown editor aimed at power users (notes, wikis, command palettes), ordered
subsequence matching is a baseline expectation: typing `it` should surface
*"Insert Table"*, not just commands whose title literally contains the string
`it`.

This change introduces a small, dependency-free **fzf-class fuzzy matcher** in
`@floatboat/nexus-core` and wires it into two consumers:

1. **Search plugin** — a new `fuzzy` flag on `SearchOptions`, a "Fuzzy" toggle
   in the search panel, and live highlight + navigate + select-all over the
   editor (so fuzzy matches are first-class, not just a programmatic API).
2. **Slash menu ranking** — `filterSlashCommands` gains a lowest-priority
   fuzzy tier, so the command palette also benefits from subsequence matching
   without changing its existing prefix / substring / keyword behaviour.

The matcher is the "backtracking matcher" the roadmap asks for: an O(m·n)
dynamic program that recovers the exact matched character offsets via
backtracking, scores alignments with boundary / camelCase / consecutive /
gap / leading penalties, and is pure and framework-free so both `core` and the
plugins can share it.

## Goals

- Provide `fuzzyMatch(query, text, options?)` and `fuzzyFilter(...)` on
  `@floatboat/nexus-core`.
- Add `fuzzy` to `SearchOptions`; `findSearchMatches` / `replaceAllMatches`
  honour it (per-line subsequence; replace affects only matched characters).
- Add a panel "Fuzzy" checkbox plus in-editor highlight, Next/Prev navigation,
  and "All" (multi-range select) for fuzzy queries.
- Upgrade `filterSlashCommands` with a fuzzy fallback tier, strictly below the
  existing prefix / substring / keyword tiers.

## Non-Goals

- No change to the existing literal / whole-word / regexp search paths. Fuzzy
  is opt-in and explicitly disabled when `regexp` is requested.
- No new runtime dependency. The matcher is ~150 lines of plain TypeScript.
- No change to the slash menu UI or its trigger behaviour.

## Impact

- `@floatboat/nexus-core`: adds public API (`fuzzyMatch`, `fuzzyFilter`) — per
  `GOVERNANCE.md §6` this requires an OpenSpec change (this one).
- `@floatboat/nexus-plugin-search`: new `fuzzy` option, panel checkbox, and
  `fuzzySearchExtension` (+ `nexusFuzzyNavigate`, `nexusFuzzySelectAll`,
  `setFuzzyQuery`, `FuzzyQuery`).
- `@floatboat/nexus-core` slash ranking: improved command discovery only.
