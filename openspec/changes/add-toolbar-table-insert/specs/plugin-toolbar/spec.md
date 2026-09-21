## ADDED Requirements

### Requirement: Toolbar Can Insert A GFM Table

`plugin-toolbar` SHALL expose an `insertTable(editor, rows, cols)` command that inserts a GitHub Flavored Markdown table at the current selection. The inserted table SHALL consist of a header row, a delimiter row, and `rows - 1` body rows, each with `cols` empty cells.

#### Scenario: Inserting a three-by-three table
- **WHEN** `insertTable` is called with `rows = 3` and `cols = 3` on an empty document
- **THEN** the document SHALL be `|   |   |   |\n|---|---|---|\n|   |   |   |\n|   |   |   |\n`
- **AND** the table SHALL have one header row and two body rows

#### Scenario: Non-finite input is rejected
- **WHEN** `insertTable` is called with `NaN` or `Infinity` for either dimension
- **THEN** the document SHALL NOT change

### Requirement: The Header Counts As The First Picked Row

The `rows` argument SHALL include the header row, so the inserted shape matches the shape the size picker drew. `rows` SHALL be clamped to a minimum of 2 so the result always has at least one body row, and `cols` SHALL be clamped to a minimum of 1.

#### Scenario: A two-by-two pick yields one body row
- **WHEN** `insertTable` is called with `rows = 2` and `cols = 2`
- **THEN** the document SHALL be `|   |   |\n|---|---|\n|   |   |\n`
- **AND** the table SHALL have exactly one body row

#### Scenario: A single row is clamped
- **WHEN** `insertTable` is called with `rows = 1`
- **THEN** the inserted table SHALL still contain a header row, a delimiter row, and one body row

### Requirement: Table Insertion Is One Undoable Transaction

The whole table SHALL be written in a single transaction so that one undo restores the document to its state before the insertion.

#### Scenario: One undo removes the whole table
- **WHEN** history is active
- **AND** `insertTable` is called over a non-empty selection
- **THEN** the selection SHALL be replaced by the table
- **AND** a single `undo` SHALL restore the original selection content

### Requirement: The Table Is Separated From Surrounding Text

When the insertion point is not already at a line boundary, `plugin-toolbar` SHALL insert a newline before the table, so it is parsed as its own block and does not merge with the preceding text. The inserted block SHALL always end with a newline.

#### Scenario: Inserting mid-line adds a leading separator
- **WHEN** the document is `abc` with the caret at the end
- **AND** `insertTable` is called with `rows = 2` and `cols = 2`
- **THEN** the document SHALL be `abc\n|   |   |\n|---|---|\n|   |   |\n`

#### Scenario: Inserting on an empty line adds no leading separator
- **WHEN** the document is empty
- **AND** `insertTable` is called
- **THEN** the document SHALL begin with `|`, not with a newline
- **AND** the document SHALL end with a newline

### Requirement: The Caret Lands On A Line Past The Table

The table renders as an atomic range, and the position pressed against its trailing edge is not one CM6 will hold a caret at — a caret sent there is rewritten to the document start, which leaves `Backspace` and `Delete` with nothing adjacent to act on and makes the table look impossible to remove. `plugin-toolbar` SHALL therefore end the inserted block with a newline and place the caret at the end of the block, so the caret rests on a line past the table.

#### Scenario: The caret can delete the table immediately
- **WHEN** `insertTable` is called
- **THEN** the caret SHALL be at the end of the document
- **AND** the document SHALL end with a newline, so the caret sits on a line past the table
- **AND** a single backward delete SHALL remove the table

### Requirement: The Size Picker Reports The Size Before Inserting

The toolbar SHALL offer a table size picker that renders a grid of selectable sizes. Hovering SHALL highlight every cell within the hovered row and column and SHALL update a text readout to `N x M` for that position. Leaving the grid SHALL reset the highlight and the readout to `0 x 0`.

#### Scenario: Hovering reports the size
- **WHEN** the picker is open
- **THEN** the readout SHALL read `0 x 0`
- **WHEN** the pointer enters the cell at row 2, column 3
- **THEN** the readout SHALL read `2 x 3`
- **AND** exactly six cells SHALL be highlighted

#### Scenario: Leaving the grid clears the readout
- **WHEN** the pointer has entered the grid and then leaves it
- **THEN** the readout SHALL read `0 x 0`
- **AND** no cell SHALL be highlighted

#### Scenario: Clicking inserts the hovered size
- **WHEN** the pointer is on the cell at row 3, column 4
- **AND** the cell is clicked
- **THEN** a table with `rows = 3` and `cols = 4` SHALL be inserted
- **AND** the picker SHALL close

### Requirement: The Size Picker Reuses The Toolbar Dropdown Contract

The picker SHALL be registered through the existing dropdown path: listed in `DROPDOWN_IDS`, opened by the button's click handler, mounted on `document.body` with `DROPDOWN_STYLES`, closed on an outside click, and torn down through the returned `destroy()` when the toolbar is destroyed.

#### Scenario: Outside click closes the picker
- **WHEN** the picker is open
- **AND** a mousedown lands outside both the picker and its button
- **THEN** the picker SHALL close

#### Scenario: Destroying the toolbar removes an open picker
- **WHEN** the picker is open
- **AND** the toolbar is destroyed
- **THEN** the picker element SHALL be removed from the document

### Requirement: Existing Toolbar Behaviour Is Unchanged

Adding the table button SHALL NOT alter the behaviour of existing toolbar buttons, their dropdowns, their tooltips, or their default ordering beyond the new button's own position.

#### Scenario: Existing buttons keep their geometry
- **WHEN** the toolbar renders with default groups
- **THEN** every pre-existing button SHALL still expose its own `aria-label`, tooltip, and action
- **AND** the table button SHALL be the only addition to the default button set
