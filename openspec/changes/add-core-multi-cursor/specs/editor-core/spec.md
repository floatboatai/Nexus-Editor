# Editor Core Spec — Multi-Cursor Config, Selections API, Selection Event

## ADDED Requirements

### Requirement: Multi-Cursor Config Flag

`EditorConfig` SHALL accept an optional `multiCursor?: boolean` (default `false`). When `true`, the editor SHALL allow multiple selection ranges (`EditorState.allowMultipleSelections`), render secondary cursors and selections via `drawSelection`, and install the multi-cursor keymap. When `false` or omitted, selection handling, caret rendering, and key bindings SHALL be byte-identical to the previous release.

#### Scenario: Default keeps single-selection behaviour
- **WHEN** an editor is created without `multiCursor`
- **AND** `setSelections` is called with two ranges
- **THEN** the resulting selection SHALL collapse to a single range (the designated main range)

#### Scenario: Flag enables multiple ranges
- **WHEN** an editor is created with `multiCursor: true`
- **AND** `setSelections` is called with two ranges
- **THEN** both ranges SHALL be retained and reported by `getSelections()`

### Requirement: Selections API

`EditorAPI` SHALL expose `getSelections(): { ranges: { anchor: number; head: number }[]; mainIndex: number }` and `setSelections(ranges: { anchor: number; head?: number }[], mainIndex?: number): void`. `getSelection()` SHALL keep returning the main range only. `setSelections` with an omitted `mainIndex` SHALL designate the last range as main, mirroring CodeMirror's `EditorSelection.create` default of the latest-added range.

#### Scenario: Round-trip through the selections API
- **WHEN** `setSelections([{ anchor: 2 }, { anchor: 10, head: 14 }], 0)` is called on a multi-cursor editor
- **THEN** `getSelections()` SHALL return both ranges with `mainIndex: 0`
- **AND** `getSelection()` SHALL return `{ anchor: 2, head: 2 }`

### Requirement: Selection Change Event Carries All Ranges

The `selectionChange` event payload SHALL be extended to `{ anchor, head, ranges, mainIndex }`, where `anchor` / `head` continue to describe the main range. Existing listeners destructuring only `anchor` / `head` SHALL observe no behavioural change.

#### Scenario: Multi-range payload
- **WHEN** the selection changes to two cursors at offsets 3 and 9 (main last)
- **THEN** `selectionChange` SHALL emit `anchor: 9, head: 9, mainIndex: 1` and `ranges` containing both `{ anchor: 3, head: 3 }` and `{ anchor: 9, head: 9 }`
