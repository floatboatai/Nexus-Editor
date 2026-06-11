# Tasks: Add history state query API

- [x] Extend `EditorAPI` interface with `canUndo()` and `canRedo()` signatures
- [x] Extend `EditorEventMap` with `historyChange` event type
- [x] Implement `canUndo()` / `canRedo()` in `editor.ts` using `undoDepth` / `redoDepth`
- [x] Track `lastCanUndo` / `lastCanRedo` in `updateListener` and emit `historyChange` on state change
- [x] Add `HistoryPluginOptions` interface with `newGroupDelay` and `minDepth`
- [x] Pass options to CodeMirror `history()` facet in `createHistoryPlugin()`
- [x] Write core tests: `canUndo` / `canRedo` API (5 cases), `historyChange` event (5 cases)
- [x] Write plugin tests: undo grouping, `canUndo`/`canRedo` integration, `historyChange` sequence (6 new cases, 2 existing preserved)
- [x] `pnpm test` passes (27/28 files, 323/332 tests — only pre-existing electron-demo Windows path failures remain)
- [x] `pnpm build` passes for affected packages
