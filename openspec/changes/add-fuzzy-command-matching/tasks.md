# Implementation Tasks

## 1. Spec and scaffolding

- [x] 1.1 Create `openspec/changes/add-fuzzy-command-matching/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-fuzzy-command-matching/design.md`.
- [x] 1.3 Create `openspec/changes/add-fuzzy-command-matching/specs/fuzzy-command-matching/spec.md`.

## 2. Core matcher

- [x] 2.1 Add `packages/core/src/fuzzy-match.ts` with `matchFuzzy(query, target, options?)`.
- [x] 2.2 Keep the alignment optimal (backtracking DP) and bounded on long targets.
- [x] 2.3 Return ascending UTF-16 code-unit positions for the matched characters.
- [x] 2.4 Export the matcher and its types from `packages/core/src/index.ts`.
- [x] 2.5 Add `packages/core/test/fuzzy-match.test.ts` covering non-matches, scoring invariants, case handling, CJK/emoji positions, determinism and the long-target path.

## 3. Slash command ranking

- [x] 3.1 Add `rankSlashCommands(commands, query)` reporting score, field, matched text and positions.
- [x] 3.2 Add the fuzzy tier below every existing literal tier and keep the existing tiebreakers.
- [x] 3.3 Keep `filterSlashCommands` a thin projection of `rankSlashCommands` so both share one ordering.
- [x] 3.4 Extend `packages/core/test/slash-state.test.ts` with fuzzy fallback, tier-precedence and position assertions.

## 4. Menu UI highlighting

- [x] 4.1 Re-export the new core symbols from `packages/plugin-slash/src/index.ts`.
- [x] 4.2 Render matched title characters as `<mark class="{prefix}-menu__match">` in `createSlashMenuUI`.
- [x] 4.3 Clear stale marks when the query changes and keep `textContent` unchanged.
- [x] 4.4 Extend `packages/plugin-slash/test/menu-ui.test.ts` with fuzzy, prefix, keyword-only and stale-mark cases.
- [x] 4.5 Style the mark element in `apps/electron-demo/src/renderer/style.css`.

## 5. Docs and verification

- [x] 5.1 Document `matchFuzzy` / `rankSlashCommands` in `packages/core/README.md`.
- [x] 5.2 Document the fuzzy tier and the new CSS hook in `packages/plugin-slash/README.md`.
- [x] 5.3 Register the roadmap entry and link this change id in `docs/ROADMAP.md`.
- [x] 5.4 `vitest run` for `core`, `plugin-slash` and the full suite.
- [x] 5.5 `pnpm typecheck` and `pnpm build` for the affected packages.
