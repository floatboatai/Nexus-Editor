## Context

CM6's `EditorState.allowMultipleSelections` facet controls whether users can create additional selection ranges via Ctrl+click, Ctrl+Alt+↑/↓, or `selectNextOccurrence`. Nexus Editor currently inherits the default (`false`). Enabling it requires auditing every code path that reads `view.state.selection.main` and deciding whether it should iterate all ranges instead.

The main risk areas are:
1. **Live-preview decorations**: Widgets (images, mermaid diagrams, tables) are bound to a single document range. If the user creates a secondary cursor inside a widget's rendered region, decoration logic must not corrupt the widget DOM.
2. **Table editing**: The table widget uses `tableEditingCount` to prevent CM6 from recreating widget DOM during drag/click operations. A secondary cursor inside an editing table cell must be deferred.
3. **Event contracts**: `selectionChange` currently fires with `{ anchor, head }` representing the primary selection. Multi-cursor consumers need all ranges.
4. **Formatting commands**: `toggleBold`, `toggleOrderedList`, etc. apply to the word/line at the primary cursor. With multiple ranges, each range must be processed independently, with offset tracking to account for concurrent document mutations.

## Goals / Non-Goals

- Goals:
  - Enable `allowMultipleSelections` by default.
  - `getSelection()` returns primary range (backwards-compatible).
  - `getSelections(): { anchor: number; head: number }[]` returns all ranges.
  - `selectionChange` event includes `ranges` array.
  - Formatting commands handle multiple ranges correctly.
  - Live-preview and table editing degrade gracefully under multi-cursor.
- Non-Goals:
  - Multi-cursor inside live-preview widgets (cursors remain in source text only).
  - Vim visual-block integration beyond what CM6 already provides.
  - AST-aware "select next occurrence" (v2).

## Decisions

### Decision 1: Enable `allowMultipleSelections` via EditorState facet, not config option

Add `EditorState.allowMultipleSelections.of(true)` to the base extensions array in `editor.ts`. No opt-out config — multi-cursor is a default editor capability. Reasoning: CM6 already handles the UX (keybindings, rendering); the work is in making Nexus code paths robust to it.

### Decision 2: `getSelection()` stays single, add `getSelections()` for all ranges

Backwards compatibility: existing callers (toolbar commands, electron-demo backlink navigation, slash menu) expect a single `{ anchor, head }`. Those remain correct — toolbar commands are updated to call `getSelections()` internally, but external consumers see no API break.

### Decision 3: Multi-range formatting: process last-to-first, track offset per range

When `toggleBold` is called with 3 cursor ranges `[{0,5}, {10,15}, {20,25}]`:
1. Sort ranges by `from` descending.
2. For each range, apply the wrap/unwrap logic on the current document state.
3. After all ranges are processed, set the document and restore all cursor positions with accumulated offsets.

This avoids the offset-drift problem where modifying range 1 shifts the positions of ranges 2 and 3.

### Decision 4: Skip live-preview widget toggling when `ranges > 1`

The decoration builder (`buildDecorations`) already checks `cursorPos` against widget ranges. When `state.selection.ranges.length > 1`, skip the "show source on cursor-in-widget" logic — widgets stay in preview mode. The user can still edit source text directly.

### Decision 5: Suppress secondary selections during table editing

In the `EditorView.updateListener`, if `isTableEditing()` is true and the transaction creates a selection with `ranges.length > 1`, filter it to keep only the primary range. Table editing relies on single-cursor invariants (per CLAUDE.md rules 8-12).

## Risks / Trade-offs

- **Risk**: Multi-cursor + table column drag creates an unrecoverable state.
  - **Mitigation**: Decision 5 — suppress any multi-cursor transaction while `tableEditingCount > 0`.
- **Risk**: Formatting commands with many ranges produce a large number of document mutations in one frame.
  - **Mitigation**: CM6 batches transactions; our loop applies one final `setDocument` call with the accumulated result. No per-range dispatch.

## Migration Plan

1. Enable the facet in core.
2. Add `getSelections()` and update `selectionChange`.
3. Update formatting commands for multi-range.
4. Add table/live-preview guards.
5. Write tests.
6. Smoke-test in electron-demo.

Rollback: remove the `allowMultipleSelections` facet line. All other changes are additive and harm no one when multi-cursor is off.

## Open Questions

- Should `setSelection` support setting arbitrary ranges beyond the primary? (Proposal: yes, add optional `rangeIndex` parameter for power users; `undefined` = replace all with a single range.)
- Should `plugin-vim`'s visual-block mode be tested as part of this change? (Proposal: out of scope for now; vim plugin is thin and visual-block already works at the CM6 level.)
