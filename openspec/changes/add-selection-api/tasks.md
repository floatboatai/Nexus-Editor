# Tasks: add-selection-api

## Phase 1: Core API

- [x] 1.1 Add `getSelectedText(): string` to `EditorAPI` interface in `packages/core/src/types.ts`
- [x] 1.2 Implement `getSelectedText()` in `packages/core/src/editor.ts` — normalize with `Math.min/max`, slice doc
- [x] 1.3 Add `replaceRange()` signature to `EditorAPI` interface in `packages/core/src/types.ts`
- [x] 1.4 Implement `replaceRange()` in `packages/core/src/editor.ts` — single `view.dispatch` with `changes` + `selection`; inline AST resync when `silent: true`
- [x] 1.5 Add focused core tests for `getSelectedText` in `packages/core/test/editor.test.ts`
- [x] 1.6 Add focused core tests for `replaceRange` in `packages/core/test/editor.test.ts`

## Phase 2: Toolbar list toggles

- [x] 2.1 Add `getLinesInRange()` helper to `packages/plugin-toolbar/src/formatting.ts` — returns every line overlapping `[from, to)`, excludes column-0 boundary line
- [x] 2.2 Add `applyLines()` helper — writes transformed lines back via `replaceRange` in one atomic transaction
- [x] 2.3 Migrate `toggleOrderedList` to use `getLinesInRange` + `applyLines`
- [x] 2.4 Migrate `toggleUnorderedList` to use `getLinesInRange` + `applyLines`
- [x] 2.5 Add multi-line and atomic-undo tests in `packages/plugin-toolbar/test/plugin-toolbar.test.ts`
