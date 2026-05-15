# Change: Add Multi-Cursor / Multi-Selection Support

## Why

CM6 supports multi-cursor editing natively via `allowMultipleSelections`, but Nexus Editor disables it (the facet defaults to `false` when omitted). The roadmap lists `[#6 Multi-cursor / multi-selection | core | P1 | planned]`. Enabling multi-cursor unlocks simultaneous editing of multiple locations — a power-user feature expected in modern editors (VS Code, Obsidian, etc.). However, enabling it naively risks breaking live-preview decorations, table widget state management, and selection-change event contracts, all of which currently assume a single `selection.main`.

## What Changes

- **Core (`@floatboat/nexus-core`)**:
  - Enable `allowMultipleSelections` in the editor state configuration.
  - Update `getSelection()` to return the **primary** selection (`.main`) — existing callers are unaffected.
  - Add `getSelections()` returning all ranges for multi-cursor-aware consumers.
  - Extend `setSelection(anchor, head)` to accept an optional third `rangeIndex` for multi-cursor positioning.
  - Update `selectionChange` event payload to include `ranges: { anchor: number; head: number }[]` alongside the primary `anchor`/`head` — additive, not breaking.
  - Wire `EditorView.updateListener` selection-set branch to emit `selectionChange` whenever **any** selection range changes (currently only fires when `.main` changes).
  - Guard live-preview decoration builder against multi-selection states: when more than one range is active, skip inline widget toggling (widgets are bound to a single position).
  - Guard table editing state: if `tableEditingCount > 0` and CM6 creates a secondary selection (e.g. Ctrl+click inside a table cell), either suppress the extra selection or defer it until editing ends. Document this interaction in the table widget rules section of `CLAUDE.md`.
- **Plugin Toolbar (`@floatboat/nexus-plugin-toolbar`)**:
  - Formatting commands (`toggleBold`, `toggleItalic`, `toggleHeading`, `toggleOrderedList`, etc.) operate on **every** selection range, not just the primary one. Each range's enclosing word/line is toggled independently, and the resulting document is produced by applying changes from last-to-first range (avoiding offset drift).
- **Docs**: `docs/ROADMAP.md` row #6 transitions to `in-progress` and links this change id.

No breaking changes: the `getSelection()` return type is unchanged; `selectionChange` gains an additive field; formatting commands produce correct results for single-selection callers (range count = 1).

## Impact

- Affected specs: `editor-core` (MODIFIED — selection API, multi-cursor contract)
- Affected code:
  - `packages/core/src/editor.ts` (enable facet, update listener, selection API methods)
  - `packages/core/src/types.ts` (EditorEventMap.selectionChange, EditorAPI additions)
  - `packages/core/src/live-preview.ts` (guard decoration builder)
  - `packages/core/src/live-preview-table.ts` (guard table editing)
  - `packages/plugin-toolbar/src/formatting.ts` (multi-range formatting)
  - `packages/core/test/editor-selection.test.ts` (NEW — multi-cursor unit tests)
  - `packages/core/test/events.test.ts` (extend selectionChange suite)
  - `packages/plugin-toolbar/test/plugin-toolbar.test.ts` (multi-range formatting tests)
  - `CLAUDE.md` (new table widget rule for multi-cursor)
  - `docs/ROADMAP.md` (status update)
- New dev dependencies: none.
- Out of scope:
  - Cross-widget cursor positions (placing a cursor inside a rendered table cell vs its markdown source).
  - Multi-cursor in `plugin-vim` (visual-block mode already works; full Vim multi-cursor commands are a v2 concern).
  - AST/diff-aware multi-cursor operations (e.g. "select next occurrence" via syntax tree).
