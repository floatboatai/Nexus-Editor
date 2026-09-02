## ADDED Requirements

### Requirement: List item indent

The core SHALL provide an `indentListItem` command, bound to `Tab` in
`markdownKeymap()`, that nests the list items under the selection beneath
their previous sibling by indenting them to that sibling's content column
as defined by CommonMark. Nested children and continuation lines of a moved
item SHALL move with it. The command SHALL return `false` when no selection
range touches a list item's marker line so that other `Tab` bindings apply.

#### Scenario: Ordered item nests at the parent's content column
- **WHEN** the document is `1. a\n2. b\n3. c` with the cursor on `2. b` and `indentListItem` runs
- **THEN** the document SHALL be `1. a\n   1. b\n2. c`
- **AND** the editor AST SHALL contain one top-level list with two items

#### Scenario: Wide markers widen the indent
- **WHEN** the document is `10. a\n11. b` with the cursor on `11. b`
- **THEN** the document SHALL be `10. a\n    1. b`

#### Scenario: Children travel with the item
- **WHEN** the document is `- a\n- b\n  - c\n  more b` with the cursor on `- b`
- **THEN** the document SHALL be `- a\n  - b\n    - c\n    more b`

#### Scenario: First item has nothing to nest under
- **WHEN** the cursor is on the first item of a list
- **THEN** the document SHALL be unchanged
- **AND** the command SHALL return `true` so no literal indentation is inserted

#### Scenario: Plain text falls through
- **WHEN** no selection range touches a list item's marker line
- **THEN** the command SHALL return `false` and leave the document unchanged

#### Scenario: Consecutive selected siblings move together
- **WHEN** a selection covers `- b` and `- c` in `- a\n- b\n- c\n- d`
- **THEN** the document SHALL be `- a\n  - b\n  - c\n- d`

#### Scenario: Blockquote prefixes are preserved
- **WHEN** the document is `> - a\n> - b\n>   more b` with the cursor on `> - b`
- **THEN** the document SHALL be `> - a\n>   - b\n>     more b`

#### Scenario: A preceding list separated by a blank line is not an anchor
- **WHEN** the document is `1. a\n\n- b` with the cursor on `- b`
- **THEN** the document SHALL be unchanged

#### Scenario: Tab indentation is measured in columns
- **WHEN** the document is `- a\n\t- b\n\t- c` with the cursor on `\t- c` and the editor's tab size is 4
- **THEN** the document SHALL be `- a\n\t- b\n      - c`
- **AND** with a tab size of 2 the document SHALL be `- a\n\t- b\n    - c`

#### Scenario: Code blocks are not lists
- **WHEN** the cursor is on a line that looks like a list item inside a fenced code block
- **THEN** the command SHALL return `false` and leave the document unchanged

### Requirement: List item outdent

The core SHALL provide an `outdentListItem` command, bound to `Shift-Tab` in
`markdownKeymap()`, that lifts the list items under the selection to their
parent's indentation. Siblings that followed a lifted item SHALL become its
children, aligned to its new content column. A top-level item SHALL only lose
stray indentation. The command SHALL return `false` when no selection range
touches a list item's marker line.

#### Scenario: Following siblings become children
- **WHEN** the document is `1. a\n   1. x\n   2. y\n2. b` with the cursor on `1. x`
- **THEN** the document SHALL be `1. a\n2. x\n   1. y\n3. b`

#### Scenario: Deep item outdents one level
- **WHEN** the document is `- a\n  - b\n    - c` with the cursor on `- c`
- **THEN** the document SHALL be `- a\n  - b\n  - c`

#### Scenario: Top-level item is unchanged
- **WHEN** the cursor is on a top-level item without leading spaces
- **THEN** the document SHALL be unchanged and the command SHALL return `true`

#### Scenario: Multiple cursors apply in document order
- **WHEN** the document is `- a\n\n  10. x\n  11. y\n  12. z` with cursors on `10. x` and `12. z`
- **THEN** the document SHALL be `- a\n\n1. x\n   1. y\n2. z`, the same result as outdenting `x` and then `z`

### Requirement: Enter continuation safety

The Enter continuation handler SHALL NOT act in a read-only state, SHALL NOT
continue a line inside a fenced or indented code block even when it looks
like a list item, and SHALL push the whole item down one line when the cursor
sits before the item's content instead of splitting the marker.

#### Scenario: Cursor before the marker
- **WHEN** the document is `1. a\n2. b` and Enter is pressed with the cursor at the start of the first line
- **THEN** the document SHALL be `\n1. a\n2. b`

#### Scenario: List-looking line in a code fence
- **WHEN** Enter is pressed at the end of `- item` inside a ```` ``` ```` fence
- **THEN** the handler SHALL return `false` so the default newline applies

#### Scenario: List inside a blockquote continues as a quoted list
- **WHEN** the document is `> 1. a\n> 2. b` and Enter is pressed at the end of the first line
- **THEN** the document SHALL be `> 1. a\n> 2. \n> 3. b`

### Requirement: Backspace at the start of a list item

The core SHALL provide a `backspaceListItem` command, bound to `Backspace` in
`markdownKeymap()`, that acts only when every cursor is empty and sits at the
start of a list item's content. A nested item SHALL be outdented exactly as
`outdentListItem` would. A top-level item SHALL lose its indentation, marker
and task box, and its continuation lines SHALL move left by the item's content
column. The sibling that followed the item SHALL restart at 1 if it now opens
a new list. Any other cursor position or a non-empty selection SHALL return
`false` so the default deletion applies.

#### Scenario: Top-level item becomes text
- **WHEN** the document is `- [ ] task` with the cursor after `- [ ] `
- **THEN** the document SHALL be `task`

#### Scenario: Nested item is outdented
- **WHEN** the document is `1. a\n   1. x\n   2. y\n2. b` with the cursor after `   1. `
- **THEN** the document SHALL be `1. a\n2. x\n   1. y\n3. b`

#### Scenario: Following list restarts
- **WHEN** the document is `1. a\n2. b\n3. c` with the cursor after `1. `
- **THEN** the document SHALL be `a\n1. b\n2. c`

#### Scenario: Cursor elsewhere falls through
- **WHEN** the cursor is at the end of `- a`
- **THEN** the command SHALL return `false` and leave the document unchanged

### Requirement: Ordered list renumbering

After `indentListItem`, `outdentListItem`, `backspaceListItem`, or the Enter
continuation handler changes list structure, every ordered list inside the affected top-level list
SHALL be renumbered consecutively within the same transaction. A list SHALL
keep its written start number unless its first item was re-parented by the
command, in which case it SHALL restart at 1. When a renumbered marker changes
width, the item's continuation lines SHALL be re-indented by the same amount.
Lists whose items use different delimiters (`.` vs `)`) are separate lists and
SHALL NOT be merged. Renumbering SHALL stop before producing a marker wider
than CommonMark's nine-digit limit.

#### Scenario: Enter in the middle of a list
- **WHEN** the document is `1. a\n2. b\n3. c` and Enter is pressed at the end of `1. a`
- **THEN** the document SHALL be `1. a\n2. \n3. b\n4. c`

#### Scenario: Exiting an empty item closes the gap
- **WHEN** the document is `1. a\n2. \n3. c` and Enter is pressed on the empty item
- **THEN** the document SHALL be `1. a\n\n2. c`

#### Scenario: Custom start number survives
- **WHEN** the document is `5. a\n6. b\n7. c` and `6. b` is indented
- **THEN** the document SHALL be `5. a\n   1. b\n6. c`

#### Scenario: Marker growth re-indents children
- **WHEN** an item numbered `9.` with a nested `   - child` becomes `10.` through renumbering
- **THEN** the nested line SHALL be indented by one more space

#### Scenario: One undo step
- **WHEN** any of the commands above changes the document and undo is invoked once
- **THEN** the document SHALL be restored to its state before the command
