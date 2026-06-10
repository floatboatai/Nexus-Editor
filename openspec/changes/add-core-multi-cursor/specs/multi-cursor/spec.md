# Multi-Cursor Spec — Commands, Key Bindings, Multi-Range Editing Semantics

## ADDED Requirements

### Requirement: Select Next Occurrence Command

`selectNextOccurrence` (bound to `Mod-d` when `multiCursor` is enabled) SHALL implement VS Code-style occurrence selection: if any selection range is empty, every empty range SHALL expand to the word under it and no new range SHALL be added in that invocation; otherwise the next occurrence of the main range's text SHALL be added as the new main range, searching forward from the last range and wrapping past the document end, skipping occurrences already covered by an existing range. The command SHALL return `false` when there is nothing to do (no word under an empty main cursor, or no unselected occurrence exists).

#### Scenario: Empty cursor expands to word
- **WHEN** the document is `foo bar foo` with a single empty cursor inside the first `foo`
- **AND** `selectNextOccurrence` runs
- **THEN** the selection SHALL become exactly the first `foo` (offsets 0–3) with no second range

#### Scenario: Second invocation adds the next occurrence
- **WHEN** the first `foo` is selected and `selectNextOccurrence` runs
- **THEN** the second `foo` (offsets 8–11) SHALL be added as the new main range, keeping the first

#### Scenario: Search wraps around the document end
- **WHEN** only the *last* occurrence of `foo` is selected and `selectNextOccurrence` runs
- **THEN** the occurrence at the start of the document SHALL be added

#### Scenario: All occurrences selected
- **WHEN** every occurrence of the main range's text is already covered by a selection range
- **THEN** the command SHALL return `false` and the selection SHALL not change

### Requirement: Add Cursor Above / Below Commands

`addCursorAbove` (`Mod-Alt-ArrowUp`) and `addCursorBelow` (`Mod-Alt-ArrowDown`) SHALL add an empty cursor on the previous / next logical line relative to the topmost / bottommost existing range, preserving the column when the target line is long enough and clamping to the target line's end otherwise. At the first / last line the command SHALL return `false`.

#### Scenario: Column preserved going down
- **WHEN** the document is `alpha\nbeta!\ngamma` with a cursor at column 4 of line 1
- **AND** `addCursorBelow` runs
- **THEN** a second cursor SHALL appear at column 4 of line 2 and both cursors SHALL remain

#### Scenario: Column clamped to a shorter line
- **WHEN** a cursor sits at column 10 and the next line has 3 characters
- **AND** `addCursorBelow` runs
- **THEN** the new cursor SHALL sit at the end of that 3-character line

### Requirement: Collapse To Main Selection

`collapseToMainSelection` (`Escape`) SHALL reduce a multi-range selection to its main range and SHALL return `false` when the selection is already a single range, so that other `Escape` bindings continue to receive the key.

#### Scenario: Escape collapses secondary cursors
- **WHEN** three cursors exist and `Escape` is pressed
- **THEN** only the main cursor SHALL remain

#### Scenario: Escape falls through on single selection
- **WHEN** a single cursor exists
- **THEN** `collapseToMainSelection` SHALL return `false` and SHALL not consume the key

### Requirement: Markdown Enter Handles Every Range

With multiple cursors, the markdown Enter handler SHALL apply its behaviour to **every** selection range in a single dispatch (one undo step): list / blockquote continuation for ranges on continuable lines, empty-item exit for empty items, and a plain newline for ranges on other lines. When **no** range is on a continuable line the handler SHALL return `false` and defer to the default Enter behaviour.

#### Scenario: Two list items continue simultaneously
- **WHEN** the document is `- a\n- b` with one cursor at the end of each line
- **AND** Enter is pressed
- **THEN** both items SHALL gain a continuation line (`- a\n- \n- b\n- `-shaped result) and both cursors SHALL sit after their new markers

#### Scenario: Mixed list and plain-text cursors
- **WHEN** one cursor is on a list item and another is on a plain paragraph line
- **AND** Enter is pressed
- **THEN** the list cursor SHALL get a continuation marker and the plain cursor SHALL get a plain newline

### Requirement: Markdown Auto-Pair Handles Every Range

The markdown auto-pair input handler SHALL apply wrapping (non-empty ranges) and pair insertion (empty ranges) at **every** selection range, evaluating the double-marker (`**`, `~~`) preceding-character check per range. Secondary cursors SHALL never lose a typed character to the handler.

#### Scenario: Backtick wraps two selections
- **WHEN** two words are selected on different lines and `` ` `` is typed
- **THEN** both words SHALL be wrapped in backticks

### Requirement: Live Preview Reveals At Every Cursor

Live-preview syntax reveal SHALL treat every selection range as a reveal trigger: inline formatting markers SHALL be visible at each range's location simultaneously, and SHALL hide again when no range remains on the corresponding line.

#### Scenario: Two bold spans reveal together
- **WHEN** the document contains two `**bold**` spans on different lines and one cursor sits in each
- **THEN** the raw `**` markers of **both** spans SHALL be visible
- **AND** collapsing to a single cursor on an unrelated line SHALL hide both again

### Requirement: Table Widget Range Checks Consider All Ranges

The table widget's whole-table-selected overlay SHALL show when **any** selection range fully covers the table source, and the widget SHALL clear an active cell-range selection only when **every** selection range head lies outside the table span. Multi-cursor editing inside table cells remains out of scope (cells are contentEditable DOM, not CodeMirror selections).

#### Scenario: Secondary range covering the table shows the overlay
- **WHEN** the main cursor is above the table and a secondary range spans the entire table source
- **THEN** the whole-table selection overlay SHALL be shown
