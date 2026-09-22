# Implementation Tasks

## 1. OpenSpec

- [x] 1.1 Create `openspec/changes/add-inline-toolbar/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-inline-toolbar/specs/plugins/spec.md`.
- [x] 1.3 Create `openspec/changes/add-inline-toolbar/tasks.md`.

## 2. Implementation

- [x] 2.1 Add `createInlineToolbarUI(editor, options)` to `packages/plugin-toolbar/src/inline-toolbar.ts`.
- [x] 2.2 Reuse `ToolbarButton` / `ToolbarGroup` and existing `toolbar-commands` actions; provide inline-only default groups.
- [x] 2.3 Subscribe to `selectionChange`, position via `getCoordsAtPos` with viewport flip + clamp.
- [x] 2.4 Handle Escape / outside mousedown / blur / IME / resize / scroll lifecycle events.
- [x] 2.5 Export `createInlineToolbarUI` and types from `packages/plugin-toolbar/src/index.ts`.

## 3. Tests

- [x] 3.1 Add `packages/plugin-toolbar/test/inline-toolbar.test.ts` covering lifecycle, button actions, dismissal, composition, and viewport changes.
- [x] 3.2 Run `pnpm test` and ensure the new tests pass without regressing existing `plugin-toolbar` tests.
