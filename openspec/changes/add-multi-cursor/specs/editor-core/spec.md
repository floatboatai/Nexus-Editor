## ADDED Requirements

### Requirement: Multi-Selection Support
The editor SHALL support multiple simultaneous selection ranges (multi-cursor). The `EditorState.allowMultipleSelections` facet SHALL be enabled by default.

#### Scenario: Create secondary cursor with keyboard
- **WHEN** the user presses Ctrl+Alt+Down (or Cmd+Opt+Down on macOS)
- **THEN** a second cursor is created one line below the primary cursor
- **AND** `editor.getSelections()` returns two ranges

#### Scenario: Create secondary cursor with mouse
- **WHEN** the user Ctrl+clicks (or Cmd+clicks on macOS) at a different position in the document
- **THEN** an additional cursor is placed at the click position
- **AND** the primary cursor is unchanged

### Requirement: Multi-Selection API
The EditorAPI SHALL expose `getSelections()` returning all active selection ranges and `getSelection()` returning the primary range only. `setSelection(anchor, head, rangeIndex?)` SHALL allow setting a specific range index or replacing all ranges.

#### Scenario: getSelections with multiple cursors
- **WHEN** the editor has 3 active cursors
- **THEN** `editor.getSelections()` returns an array of 3 `{ anchor, head }` objects
- **AND** `editor.getSelection()` returns the primary range (first in the array)

#### Scenario: setSelection at specific range index
- **WHEN** `editor.setSelection(10, 20, 1)` is called with 3 active ranges
- **THEN** only range index 1 is updated; ranges 0 and 2 are unchanged

#### Scenario: setSelection without rangeIndex
- **WHEN** `editor.setSelection(5, 15)` is called (no third argument)
- **THEN** all existing ranges are replaced with a single range `{ anchor: 5, head: 15 }`

### Requirement: Selection Change Event with Ranges
The `selectionChange` event payload SHALL include a `ranges` array containing all active selection ranges, in addition to the primary `anchor` and `head`. This is additive — existing consumers reading `anchor`/`head` continue to work.

#### Scenario: selectionChange fires with multiple ranges
- **WHEN** the user adds a second cursor via Ctrl+Alt+Down
- **THEN** the `selectionChange` event fires with `{ anchor, head, ranges: [{...}, {...}] }`
- **AND** `anchor` and `head` match the primary range

#### Scenario: selectionChange fires for non-primary range changes
- **WHEN** the user moves a secondary cursor (not the primary) via mouse drag
- **THEN** the `selectionChange` event fires with updated `ranges`
- **AND** the primary `anchor` and `head` may be unchanged

### Requirement: Formatting Commands Handle Multiple Ranges
Toolbar formatting commands (`toggleBold`, `toggleItalic`, `toggleHeading`, `toggleOrderedList`, `toggleUnorderedList`, `toggleBlockquote`, `toggleStrikethrough`, `toggleInlineCode`) SHALL apply to every active selection range independently.

#### Scenario: Bold toggling across three ranges
- **WHEN** 3 non-overlapping text ranges are selected
- **AND** `toggleBold` is invoked
- **THEN** each range is independently wrapped with `**` (or unwrapped if already wrapped)
- **AND** the resulting document is correct (no offset corruption between ranges)

#### Scenario: Ordered list toggle on multiple lines via multi-cursor
- **WHEN** cursors are placed on 3 separate lines
- **AND** `toggleOrderedList` is invoked
- **THEN** each line receives an ordered list prefix (`1.`, `2.`, `3.`)
- **AND** invoking `toggleOrderedList` again removes all prefixes

### Requirement: Live-Preview Guard Under Multi-Cursor
Live-preview widget toggling SHALL be suppressed when more than one selection range is active. Widgets remain in preview mode; the user can still edit source text directly.

#### Scenario: Multiple cursors near a table widget
- **WHEN** a table widget is rendered in the live preview
- **AND** the user has 2 active cursors, one of which is inside the table's source range
- **THEN** the table remains in preview mode (no source-text toggle)
- **AND** text editing at the cursor position in the source line is still possible

### Requirement: Table Editing Guard Under Multi-Cursor
Secondary selections SHALL be suppressed during active table editing (`tableEditingCount > 0`). Only the primary selection range is preserved.

#### Scenario: Ctrl+click during table column drag
- **WHEN** the user is dragging a table column grip (`tableEditingCount = 1`)
- **AND** the user Ctrl+clicks elsewhere in the document
- **THEN** the secondary cursor is not created
- **AND** the column drag operation continues unaffected

## MODIFIED Requirements

### Requirement: Editor Selection API (getSelection)
`editor.getSelection()` returns the primary selection range `{ anchor: number; head: number }`. When multiple cursors are active, this is the first range in `state.selection.ranges`. The return type is unchanged from the single-cursor era.

#### Scenario: Single cursor
- **WHEN** one cursor is active at position 5
- **THEN** `getSelection()` returns `{ anchor: 5, head: 5 }`

#### Scenario: Multiple cursors
- **WHEN** two cursors are active at positions 5 and 10
- **THEN** `getSelection()` returns `{ anchor: 5, head: 5 }` (the primary range)
