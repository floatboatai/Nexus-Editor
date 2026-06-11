# Proposal: Add history state query API

## Summary

Add `canUndo()` / `canRedo()` methods to `EditorAPI` and a `historyChange` event to `EditorEventMap`, enabling host UIs to reflect the current undo/redo stack state. Also enhance `@floatboat/nexus-plugin-history` with configurable undo grouping via `newGroupDelay` and `minDepth` options.

## Motivation

- **ROADMAP #8**: Undo / redo grouping is a P1 item
- **Toolbar UX**: Host UIs (React, Vue, Electron) need to know when undo/redo buttons should be enabled/disabled
- **Plugin minimalism**: `plugin-history` is currently a one-line wrapper — it should expose the history configuration that CodeMirror already supports

## Scope

- `packages/core`: `canUndo()`, `canRedo()`, `historyChange` event
- `packages/plugin-history`: `HistoryPluginOptions` (`newGroupDelay`, `minDepth`)

## Non-goals

- Custom history stack (we rely on CodeMirror's built-in `history()` facet)
- History persistence / serialization (P2 item, separate proposal)
