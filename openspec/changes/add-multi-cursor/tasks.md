# Implementation Tasks

## 1. Core — enable multi-cursor and update selection API

- [ ] 1.1 Add `EditorState.allowMultipleSelections.of(true)` to the base extensions in `packages/core/src/editor.ts`.
- [ ] 1.2 Add `getSelections(): { anchor: number; head: number }[]` to the API object in `packages/core/src/editor.ts`, returning all `state.selection.ranges`.
- [ ] 1.3 Extend `setSelection(anchor, head, rangeIndex?)` so `rangeIndex` controls which range to replace; `undefined` (default) replaces all with a single range. Implement in `packages/core/src/editor.ts`.
- [ ] 1.4 Update `EditorAPI` interface in `packages/core/src/types.ts` with `getSelections()` and the extended `setSelection` signature.
- [ ] 1.5 Extend `EditorEventMap.selectionChange` payload to include `ranges: { anchor: number; head: number }[]` in `packages/core/src/types.ts`.
- [ ] 1.6 Update the `EditorView.updateListener` selection-set branch in `packages/core/src/editor.ts` to include `ranges` in the emitted `selectionChange` event.
- [ ] 1.7 Export any new types from `packages/core/src/index.ts`.

## 2. Core — live-preview and table editing guards

- [ ] 2.1 In `packages/core/src/live-preview.ts`, add a guard in the decoration builder: when `state.selection.ranges.length > 1`, skip the cursor-inside-widget toggle logic (keep widgets in preview mode).
- [ ] 2.2 In the `EditorView.updateListener` in `packages/core/src/editor.ts`, filter `selection` in dispatched transactions: if `isTableEditing()` and `selection.ranges.length > 1`, keep only the primary range. Emit a console warning once per editing session.
- [ ] 2.3 Add rule 13 to `CLAUDE.md` table widget rules: "Multi-cursor selections are suppressed during table editing (`tableEditingCount > 0`)."

## 3. Plugin Toolbar — multi-range formatting

- [ ] 3.1 Add a helper `applyToEachRange(doc, ranges, fn)` in `packages/plugin-toolbar/src/formatting.ts` that iterates ranges last-to-first, applies `fn(doc, range)` returning `{ newDoc, newRange }`, and returns the final document + adjusted ranges.
- [ ] 3.2 Update `toggleBold`, `toggleItalic`, `toggleStrikethrough`, `toggleInlineCode`, `toggleWrap` to use the multi-range helper.
- [ ] 3.3 Update `toggleOrderedList`, `toggleUnorderedList`, `toggleBlockquote`, `toggleHeading` to use the multi-range helper.
- [ ] 3.4 Update `insertLink`, `insertImage`, `insertCodeBlock`, `insertHorizontalRule` to use `getSelections()` — for insertion commands, only the primary range is used (insertion at multiple points is undefined behavior for templates).

## 4. Tests

- [ ] 4.1 Create `packages/core/test/editor-selection.test.ts` covering: single `getSelection` matches primary, `getSelections` returns all ranges, `setSelection` replaces all by default, `setSelection` with `rangeIndex` targets a specific range, multi-cursor dispatch creates multiple ranges.
- [ ] 4.2 Extend `packages/core/test/events.test.ts`: assert `selectionChange` includes `ranges` array, assert `ranges.length > 1` when Ctrl+Alt+Down is pressed (or via programmatic multi-range dispatch).
- [ ] 4.3 Add multi-range formatting tests to `packages/plugin-toolbar/test/plugin-toolbar.test.ts`: bold toggling on 3 non-overlapping ranges produces correct document, ordered list toggling on 3 lines with multiple cursors, italic wrap/unwrap on adjacent ranges does not corrupt offsets.
- [ ] 4.4 Add table editing guard test: creating a secondary cursor while `isTableEditing()` is true is suppressed.

## 5. Documentation

- [ ] 5.1 Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md` row #6 to `in-progress` and link `add-multi-cursor`.
- [ ] 5.2 Add a brief note to `packages/core/README.md` (if it exists) documenting `getSelections()` and the extended `setSelection`.

## 6. Verify + Validate

- [ ] 6.1 `pnpm test` passes all existing and new tests.
- [ ] 6.2 `pnpm build` succeeds for all packages.
- [ ] 6.3 `pnpm typecheck` reports no errors.
- [ ] 6.4 Manual smoke test in electron-demo: Ctrl+Alt+Down creates a second cursor; typing inserts at both positions; Ctrl+click places additional cursors; bold/italic toggle affects all cursors; table drag operations are unaffected.
- [ ] 6.5 `openspec validate add-multi-cursor --strict` passes.
