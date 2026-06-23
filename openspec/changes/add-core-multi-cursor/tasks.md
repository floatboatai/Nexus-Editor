# Implementation Tasks

## 1. Core — enablement, commands, keymap

- [x] 1.1 Add `EditorConfig.multiCursor?: boolean` to `packages/core/src/types.ts` with JSDoc covering the default and what it enables.
- [x] 1.2 Create `packages/core/src/multi-cursor.ts`: `selectNextOccurrence`, `addCursorAbove`, `addCursorBelow`, `collapseToMainSelection` commands plus `multiCursorExtension()` bundling `allowMultipleSelections`, an explicit Alt-click `clickAddsSelectionRange` facet, `drawSelection()`, cursor/selection base theme (CSS vars), and the keymap (`Mod-d`, `Mod-Alt-ArrowUp/Down`, `Escape`).
- [x] 1.3 Wire `config.multiCursor` into the extension list in `packages/core/src/editor.ts`.
- [x] 1.4 Export the commands and new types from `packages/core/src/index.ts`.

## 2. Core — selections API and event

- [x] 2.1 Add `getSelections()` / `setSelections(ranges, mainIndex?)` to `EditorAPI` (types + implementation).
- [x] 2.2 Extend the `selectionChange` payload with `ranges` + `mainIndex` while keeping `anchor` / `head` as the main range; update the exact-payload assertion in `packages/core/test/events.test.ts` to the new contract.

## 3. Core — multi-range editing correctness

- [x] 3.1 Rewrite `handleMarkdownEnter` to process every selection range in one dispatch (continuation / empty-item exit / plain newline), returning `false` only when no range is on a continuable line. Same-line duplicate ranges: first wins.
- [x] 3.2 Rewrite `markdownAutoPair` to wrap / pair at every range, with the double-marker char-before check evaluated per range.
- [x] 3.3 Widen the two `selection.main` checks in `live-preview-table.ts` (whole-table overlay → `ranges.some`, leave-table clear → `ranges.every`), re-reading the 12 table rules in `CLAUDE.md` before touching the file.

## 4. Tests

- [x] 4.1 New `packages/core/test/multi-cursor.test.ts` (27 cases): config gating, `setSelections`/`getSelections`, `selectionChange` ranges payload, `selectNextOccurrence` (word expansion, add next, wrap-around, skip-selected, no-match → false), `addCursorAbove/Below` (column preserve, clamp, document edge → false), `collapseToMainSelection` (multi → main, single → false), keymap smoke tests (Mod-d, Escape, flag-off), multi-cursor Enter (two list items, mixed, same-line exit dedupe, defer-to-default) and auto-pair (backtick wrap ×2, double-marker ×2, mixed plain-insert).
- [x] 4.2 Existing single-cursor suites pass unmodified (`markdown-keymap.test.ts` behaviour lock); multi-range Enter cases live in `multi-cursor.test.ts`.
- [x] 4.3 Extend `packages/core/test/live-preview-regressions.test.ts`: two cursors reveal raw markers in two separate inline spans simultaneously; moving to a single cursor elsewhere hides both.
- [x] 4.4 `pnpm test` (345 tests, 29 files), `pnpm build`, `pnpm typecheck` all green. Added `vitest.setup.ts` stubbing jsdom's missing `Range.getClientRects` / `getBoundingClientRect` so drawSelection's measure cycle stops logging caught TypeErrors to stderr.

## 5. Demo + docs

- [x] 5.1 Enable `multiCursor: true` in `apps/electron-demo/src/renderer/editor-shell.ts` (`pnpm build:electron-demo` green; manual Alt-click / Mod-d / Mod-Alt-Arrow walkthrough in the running demo is the remaining reviewer step).
- [x] 5.2 Create `packages/core/README.md` documenting the flag, key bindings, commands, and selections API.
- [x] 5.3 Update `docs/ROADMAP.md` + `docs/ROADMAP.zh.md` row #6 → `in-progress`, link `add-core-multi-cursor`.
