# Plugin Toolbar Spec

## ADDED Requirements

### Requirement: insertTable inserts a well-formed GFM table atomically

`insertTable(editor, options?)` SHALL insert a GitHub-Flavored Markdown table at the caret as a single atomic `replaceRange` transaction (one undo entry). The table SHALL consist of an optional header row, a mandatory delimiter row, and `rows` body rows (each body cell empty). Column count, row count, and header presence SHALL be configurable via `InsertTableOptions` (`cols`, `rows`, `includeHeaderRow`), each clamped to a sensible minimum (at least 1 column, 1 body row; header defaults to `true`). Surrounding newlines SHALL be added only when the insertion site is not already at a line boundary, so insertion into the middle of a paragraph or at document start/end stays well-formed. The caret SHALL be placed inside the first cell of the first body row. A non-empty selection SHALL be replaced by the table (its text discarded), consistent with the other insert commands in this module.

#### Scenario: Default table inserts 3x3 with header
- **WHEN** `insertTable(editor)` is called at a collapsed caret on an empty document
- **THEN** a 3-column, 3-body-row table with a header row and delimiter row SHALL be inserted
- **AND** columns SHALL be separated by `|` and the delimiter row SHALL contain `---` cells

#### Scenario: Caret lands in the first body cell
- **WHEN** `insertTable` completes
- **THEN** the caret SHALL be positioned inside the first cell of the first body row so the user can type immediately

#### Scenario: Configured columns and rows
- **WHEN** `insertTable(editor, { cols: 2, rows: 1, includeHeaderRow: false })` is called
- **THEN** the inserted table SHALL have 2 columns, 1 body row, no header row, and still include the delimiter row

#### Scenario: Non-empty selection is replaced
- **WHEN** `insertTable` is called with a non-empty selection
- **THEN** the selected text SHALL be discarded and replaced by the table

#### Scenario: Atomic undo
- **WHEN** `insertTable` is called
- **THEN** a single `undo()` SHALL remove the entire table and restore the caret

### Requirement: toggleTaskList converts and toggles task markers across the selection

`toggleTaskList(editor)` SHALL read the full selection range (normalizing reversed selections) and rewrite every intersecting line via `getLinesInRange` + `applyLines` in one atomic transaction. If **every** intersecting line is already a task item (`/^(\s*)([-*+]\s+)\[([ xX])\]\s?(.*)$/`), the task markers SHALL be removed and the lines revert to plain text (toggle off). Otherwise every intersecting line SHALL become a `- [ ]` task item, converting plain text, unordered bullets, and ordered list markers in one pass. Lines that are already task items when not toggling off SHALL be normalized to an unchecked `- [ ]` marker. The column-0 boundary rule (a line whose start equals the selection end is excluded) SHALL apply as in `getLinesInRange`.

#### Scenario: Plain text becomes task list
- **WHEN** `toggleTaskList` is called on a plain line
- **THEN** the line SHALL gain a `- [ ] ` marker

#### Scenario: Unordered bullet becomes task list
- **WHEN** `toggleTaskList` is called on a `- item` line
- **THEN** the line SHALL become `- [ ] item`

#### Scenario: Ordered list becomes task list
- **WHEN** `toggleTaskList` is called on a `1. item` line
- **THEN** the line SHALL become `- [ ] item`

#### Scenario: All tasks toggle off
- **WHEN** `toggleTaskList` is called on lines that are all task items
- **THEN** every task marker SHALL be removed and the original text preserved

#### Scenario: Multi-line conversion in one undo step
- **WHEN** `toggleTaskList` is called on a multi-line selection
- **THEN** all lines SHALL become task items
- **AND** a single `undo()` SHALL restore every line

### Requirement: toggleTaskChecked flips the checked state of task items

`toggleTaskChecked(editor)` SHALL read the full selection range and flip `- [ ]` to `- [x]` and `- [x]`/`-[X]` to `- [ ]` on a per-line basis via `getLinesInRange` + `applyLines` in one atomic transaction. Lines that are NOT task items SHALL be left unchanged. When no intersecting line is a task item, the command SHALL be a no-op and return `false`.

#### Scenario: Unchecked becomes checked
- **WHEN** `toggleTaskChecked` is called on a `- [ ] item` line
- **THEN** the line SHALL become `- [x] item`

#### Scenario: Checked becomes unchecked
- **WHEN** `toggleTaskChecked` is called on a `- [x] item` line
- **THEN** the line SHALL become `- [ ] item`

#### Scenario: Non-task lines are untouched
- **WHEN** `toggleTaskChecked` is called on a selection containing only plain text or bullets
- **THEN** the document SHALL be unchanged and the command SHALL return `false`

#### Scenario: Atomic undo
- **WHEN** `toggleTaskChecked` flips a task item
- **THEN** a single `undo()` SHALL restore the previous checked state