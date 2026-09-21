# Tasks: add-toolbar-table-tasklist

## Phase 1: Core commands

- [x] 1.1 Add `InsertTableOptions` interface and `buildTableRow` helper to `packages/plugin-toolbar/src/formatting.ts`
- [x] 1.2 Implement `insertTable` — configurable cols/rows/header, atomic `replaceRange`, caret in first body cell, replace non-empty selection
- [x] 1.3 Implement `toggleTaskList` — convert/toggle task markers across selection using `getLinesInRange` + `applyLines`
- [x] 1.4 Implement `toggleTaskChecked` — flip `- [ ]`↔`- [x]` per line, no-op when no task items
- [x] 1.5 Re-export the three commands from `packages/plugin-toolbar/src/index.ts`

## Phase 2: Integration & polish

- [x] 2.1 Add `iconTable`, `iconTaskList`, `iconTaskToggle` to `packages/plugin-toolbar/src/icons.ts`
- [x] 2.2 Register `table`, `task-list`, `task-toggle` slash commands in `packages/plugin-toolbar/src/toolbar-commands.ts`
- [x] 2.3 Add `table`, `task-list`, `task-toggle` buttons to default toolbar groups in `packages/plugin-toolbar/src/toolbar-ui.ts`
- [x] 2.4 Expand JSDoc on `insertTable` to document the selection-replace semantic
- [x] 2.5 Make `toggleTaskList` off-path use explicit group concatenation instead of a `$`-substitution for readability/safety

## Phase 3: Tests

- [x] 3.1 Add `insertTable` tests (default, options, caret placement, boundary newlines, replace non-empty selection)
- [x] 3.2 Add `toggleTaskList` tests (add, toggle-off, ordered→task, plain→task, mixed, multi-line, atomic undo)
- [x] 3.3 Add `toggleTaskChecked` tests (check, uncheck, mixed, no-op, atomic undo)
- [x] 3.4 Add slash-command + UI-button tests for `table`, `task-list`, `task-toggle`