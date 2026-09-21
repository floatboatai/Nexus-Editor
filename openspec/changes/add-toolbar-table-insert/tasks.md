# Implementation Tasks

## 1. Phase 1 - OpenSpec and Red Tests

- [x] 1.1 Create `openspec/changes/add-toolbar-table-insert/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-toolbar-table-insert/specs/plugin-toolbar/spec.md`.
- [x] 1.3 Add failing `plugin-toolbar` tests for `insertTable` shapes, clamping, and single-undo replacement.
- [x] 1.4 Run the targeted `plugin-toolbar` tests and confirm failures are limited to the unimplemented command.

## 2. Phase 2 - Insert Command

- [x] 2.1 Add `insertTable(editor, rows, cols)` to `packages/plugin-toolbar/src/formatting.ts`.
- [x] 2.2 Count the header as the first row and clamp `rows` to a minimum of 2.
- [x] 2.3 Write the table through `editor.replaceRange` so it lands as one undoable transaction.
- [x] 2.4 Add leading and trailing newlines only when the insertion point is not already at a line boundary.
- [x] 2.5 Export `insertTable` from `packages/plugin-toolbar/src/index.ts`.

## 3. Phase 3 - Size Picker

- [x] 3.1 Add `iconTable` to `packages/plugin-toolbar/src/icons.ts`, matching the existing 18-unit / 1.8-stroke set.
- [x] 3.2 Add `showTableGridPicker(editor, anchorBtn, onClose)` rendering a 6 x 6 grid plus an `N x M` readout.
- [x] 3.3 Highlight every cell within the hovered row and column, and reset on `mouseleave`.
- [x] 3.4 Insert the hovered size on click and close the picker.
- [x] 3.5 Register the picker in `DROPDOWN_IDS` and the button's click handler; add the button to `defaultGroups`.
- [x] 3.6 Keep `packages/core/**`, `packages/plugin-slash/**`, and `color-decoration.ts` unchanged.

## 4. Phase 4 - Verification

- [x] 4.1 Run the targeted `plugin-toolbar` tests and confirm the new red tests pass.
- [x] 4.2 Run the full suite and confirm no regressions.
- [x] 4.3 Run `pnpm typecheck`, `pnpm check:api`, and `pnpm build`.
- [x] 4.4 Verify in the real Electron demo that the picker opens, reports `2 x 3` on hover, highlights six cells, closes on click, and renders the inserted table through the live-preview widget.
