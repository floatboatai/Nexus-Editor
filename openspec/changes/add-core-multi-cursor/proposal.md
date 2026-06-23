# Change: Add Multi-Cursor / Multi-Selection Support to Core

## Why

Roadmap item **#6 — Multi-cursor / multi-selection (`core`, P1)** is the highest-priority core editing feature not yet started. CodeMirror 6 ships the underlying machinery (`EditorState.allowMultipleSelections`, `drawSelection`), but Nexus never enables it, so today any attempt to create multiple selection ranges silently collapses to a single range.

Simply turning the facet on is not enough — the roadmap row itself warns: *"CM6 supports it; must verify live-preview and table interactions"*. An audit of the codebase found four concrete gaps that make naive enablement broken or lossy:

1. **No rendering**: secondary cursors and selections are invisible without `drawSelection()` (the native DOM selection can only show one range).
2. **`handleMarkdownEnter` is main-range only** (`packages/core/src/markdown-keymap.ts`): with two cursors on two list items, pressing Enter continues the list at the main cursor and *drops the keystroke entirely* for every other cursor, because the keymap consumes the event after dispatching a single-range change.
3. **`markdownAutoPair` is main-range only** (`packages/core/src/markdown-autopair.ts`): the input handler wraps/pairs at the main selection and returns `true`, so secondary cursors lose the typed character.
4. **No commands or API**: there is no way to *create* multiple cursors from the keyboard (select-next-occurrence, add-cursor-above/below), and `getSelection` / `setSelection` / the `selectionChange` event only speak single-range.

The live-preview decoration pipeline is already multi-range aware (`buildDecorations` receives `state.selection.ranges` and the helpers in `live-preview-ranges.ts` use `.some()` across ranges), which keeps this change tractable: the work is enablement, command surface, multi-range correctness in the two keymap/input handlers, API exposure, and regression coverage for live-preview/table interplay.

## What Changes

- **Core (`@floatboat/nexus-core`)**:
  - New `EditorConfig.multiCursor?: boolean` (default **`false`**). When enabled, the editor activates `EditorState.allowMultipleSelections` + `drawSelection()` and installs the multi-cursor keymap. Default-off keeps existing consumers pixel-identical (drawSelection replaces the native caret/selection layer, a visible rendering change).
  - **New module `packages/core/src/multi-cursor.ts`** exporting four standalone CodeMirror commands (usable by hosts/plugins regardless of config) and the bundled extension:
    - `selectNextOccurrence` (`Mod-d`) — VS Code-style: empty ranges expand to the word under each cursor first; subsequent invocations add the next occurrence of the main-range text, searching forward from the last range and wrapping past the end of the document; occurrences already covered by a range are skipped. Implemented in-core with a plain document scan — no `@codemirror/search` dependency, which would pull panel/UI infrastructure into every core bundle.
    - `addCursorAbove` (`Mod-Alt-ArrowUp`) / `addCursorBelow` (`Mod-Alt-ArrowDown`) — add a cursor on the previous/next *logical* line, preserving the column where the line is long enough and clamping to the line end otherwise. Returns `false` at the document edge.
    - `collapseToMainSelection` (`Escape`) — drop secondary ranges, keep the main one. Returns `false` when the selection is already single-range so other Escape handlers (slash menu, search panel) keep working.
  - **API additions** (all additive, no breaking changes):
    - `getSelections(): { ranges: { anchor: number; head: number }[]; mainIndex: number }`
    - `setSelections(ranges, mainIndex?)` — multiple ranges require `multiCursor: true`; otherwise CM collapses to the main range (documented).
    - `selectionChange` event payload gains `ranges` and `mainIndex` fields alongside the existing `anchor` / `head` (which keep describing the main range).
  - **Multi-range correctness fixes**:
    - `handleMarkdownEnter` rewritten to handle *every* selection range: list/blockquote continuation per cursor, empty-item exit per cursor, plain newline for cursors on non-continuable lines. Single-cursor behaviour is unchanged (verified by the existing `markdown-keymap.test.ts` suite).
    - `markdownAutoPair` rewritten per-range: wrap each non-empty range, pair-insert at each empty cursor, with the double-marker (`**`, `~~`) char-before check evaluated per range.
  - **Table widget** (`live-preview-table.ts`, read-only condition tweaks audited against all 12 CLAUDE.md table rules): the whole-table-selected overlay check and the "cursor left the table" range-clear check now consider all selection ranges, not just the main one.
- **Electron demo**: enables `multiCursor: true` in `editor-shell.ts` so the feature is exercised end-to-end.
- **Docs**: new `packages/core/README.md` section documenting the config flag, commands, key bindings, and the selections API; `docs/ROADMAP.md` (+ zh) row #6 → `in-progress` with this change id linked.

React/Vue bindings need no code change: both spread `EditorConfig` through (`UseEditorConfig = Omit<EditorConfig, "container">`), so `multiCursor` flows to `createEditor` automatically.

## Impact

- Affected specs:
  - `editor-core` (ADDED — `multiCursor` config, selections API, `selectionChange` ranges payload)
  - `multi-cursor` (ADDED — new capability: commands, key bindings, multi-range editing semantics, live-preview/table interplay)
- Affected code:
  - `packages/core/src/multi-cursor.ts` (NEW)
  - `packages/core/src/editor.ts` (wire config, extend API + event payload)
  - `packages/core/src/types.ts` (config, API, event types)
  - `packages/core/src/markdown-keymap.ts` (per-range Enter handling)
  - `packages/core/src/markdown-autopair.ts` (per-range wrap/pair)
  - `packages/core/src/live-preview-table.ts` (range-aware overlay/clear checks)
  - `packages/core/src/index.ts` (export commands + types)
  - `packages/core/test/multi-cursor.test.ts` (NEW)
  - `packages/core/test/live-preview-regressions.test.ts` (multi-cursor reveal regression)
  - `packages/core/test/events.test.ts` (selectionChange payload contract)
  - `vitest.setup.ts` (NEW — stubs jsdom's missing `Range.getClientRects` for drawSelection's measure cycle) + `vitest.config.ts` (`setupFiles`)
  - `apps/electron-demo/src/renderer/editor-shell.ts` (enable flag)
  - `packages/core/README.md` (NEW), `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- New dependencies: none.
- Out of scope (explicit non-goals):
  - Multi-cursor editing *inside* table-widget cells — cells are contentEditable DOM, not CM selections; the widget keeps its own single-cell editing model.
  - IME composition across multiple ranges — CM6 composes at the main range only; secondary-range replication during composition follows upstream behaviour.
  - Rectangular (Alt-drag column) selection — `rectangularSelection()`/`crosshairCursor()` can layer on later; keyboard + Alt-click + Mod-d cover the roadmap intent.
  - A `selectAllOccurrences` command (Mod-Shift-l) — trivial to add later on top of the same scan helper, kept out to limit keymap surface.
