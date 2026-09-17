# Change: Add Fuzzy Matching to Core and the Slash Menu

## Why

Roadmap item 17 asks for fuzzy matching in the *Search / Commands* area and explicitly notes that it "needs a backtracking matcher". Today `filterSlashCommands` only understands literal tiers (exact, prefix, substring), so the non-contiguous queries people habitually type in command palettes — `/tbl` for **Table**, `/h2`, `/bqi`, `/表格` — return "No matches" even when the intended command is obvious.

In-document search is a different problem: it walks the document in position order and its results are meaningful as positions, not as a ranked list. This change therefore adds the matcher as a general core capability and applies it to the candidate-list surface (the slash menu) instead of bolting a ranking mode onto the `@codemirror/search` panel.

## What Changes

- Add a dependency-free fuzzy (subsequence) matcher to `@floatboat/nexus-core`, exposed as `matchFuzzy(query, target, options?)`.
- Score alignments so word starts, camelCase humps, adjacent characters and prefix hits outrank scattered mid-word hits; return the matched positions so callers can highlight them.
- Add a fuzzy tier to slash command ranking, below every existing literal tier, so `/tbl` finds **Table** while `/table` keeps its current order.
- Add `rankSlashCommands(commands, query)` to `@floatboat/nexus-core` (and re-export it from `@floatboat/nexus-plugin-slash`) so hosts can render ranked candidates *and* their match positions without reimplementing the ranker.
- Highlight the matched title characters in `createSlashMenuUI` through `<mark class="{classPrefix}-menu__match">`.
- Document the capability, the scoring model and the new CSS class.

## Non-Goals

- No fuzzy mode for the in-document search panel (`@codemirror/search` keeps literal + regex semantics).
- No new runtime dependencies — the matcher is written by hand rather than pulling in `fzf`-like packages.
- No change to the existing literal tiers and their tiebreakers: a list whose candidates all match literally must rank exactly as it does today.
- No host-specific UI components; the menu keeps rendering its own DOM with class hooks for host styling.

## Impact

- Affected specs: `fuzzy-command-matching` (new capability)
- Affected code:
  - `packages/core/src/fuzzy-match.ts` (new)
  - `packages/core/src/slash-state.ts`, `packages/core/src/index.ts`
  - `packages/plugin-slash/src/menu-ui.ts`, `packages/plugin-slash/src/index.ts`
  - `packages/core/README.md`, `packages/plugin-slash/README.md`, `docs/ROADMAP.md`
  - `apps/electron-demo/src/renderer/style.css` (style hook for the new mark element)
- **No breaking changes**: `filterSlashCommands` keeps its signature and its ordering for literal matches; fuzzy results are only additive.
