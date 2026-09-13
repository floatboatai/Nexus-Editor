## ADDED Requirements

### Requirement: Developers can opt in to a shared block-reordering capability

The system SHALL provide block reordering for desktop browsers and Electron through an official plugin, supporting static integration and runtime activation without depending on file or workspace services. Electron SHALL enable it by default, while library consumers SHALL opt in. Live preview and source mode MUST use the same movement rules.

#### Scenario: Integrating the plugin into an application

- **WHEN** a developer enables the plugin for an editor
- **THEN** users can reorder content in both live preview and source mode
- **AND** the developer does not need separate movement implementations for each view or host

#### Scenario: Disabling the plugin with multiple editors present

- **WHEN** the host disables block reordering
- **THEN** the handles and interactions are removed from the affected editor
- **AND** the editor instance, document, selection, and history remain intact, without affecting other editors

### Requirement: Users move one complete content block at a time

The plugin SHALL support moving a single outermost paragraph, heading, list, blockquote, code block, table, or thematic break within the same document. Lists and blockquotes include all their internal content, images move with their containing paragraph, and headings move only themselves. Folded headings SHALL have no handle. Unsupported blocks MUST retain their original text.

#### Scenario: Moving a list before an explanation

- **WHEN** a user drags a complete list that contains nested lists
- **THEN** all items, nested items, and indentation move together without losing or duplicating content
- **AND** an existing text selection does not expand the operation into a multiple-block move

#### Scenario: Changing content order

- **WHEN** a user moves a table, code block, or paragraph containing an image
- **THEN** the complete content moves with its internal structure unchanged
- **AND** moving a heading does not move the body content beneath it

### Requirement: Users can anticipate destinations and control movement

The plugin SHALL provide a handle, drag feedback, valid-destination indicators, edge scrolling, and equivalent keyboard operations. A drag interaction starts only after movement exceeds the activation threshold; clicking the handle does not change the document or open a menu. Handle hover and the source block during dragging SHALL use only background highlighting, while keyboard focus SHALL remain visible. Touch input MUST retain existing scrolling behavior.

#### Scenario: Dragging within a long document

- **WHEN** a user drags content near the editor edge
- **THEN** the document scrolls automatically and indicates valid destinations
- **AND** scrolling stops after a drop or cancellation

#### Scenario: Reordering with the keyboard

- **WHEN** a user presses `Alt+Shift+Up/Down` in the editor or an arrow key on a focused handle
- **THEN** the current block moves up or down under the same rules and the move can be undone
- **AND** pressing Esc on the handle returns to the editor, while input controls within blocks retain their own key behavior

### Requirement: Reordering preserves content meaning and can be reversed

A move MUST preserve the original Markdown text, allowing only necessary whitespace adjustments between blocks. Destinations SHALL be between outermost blocks in the current document or at its start or end; destinations that merge or reinterpret content MUST be rejected. A successful move MUST follow host transaction rules and be submitted as a single operation isolated from preceding and subsequent input, with selections mapped to follow their content.

#### Scenario: Undoing a completed drop

- **WHEN** a user completes a move and performs one undo
- **THEN** the original order and selection are restored while earlier input remains intact
- **AND** redo restores the result of the move

#### Scenario: Invalid movement or host rejection

- **WHEN** a destination would change content structure, belongs to another editor, is equivalent to the original position, or the host rejects the change
- **THEN** the attempted move does not alter the document or undo history and is not reported as successful
- **AND** no extra markers are inserted and no content is rewritten to force the move

### Requirement: Block reordering coexists with existing editing flows

The plugin MUST prevent movement from starting in read-only mode or during composition input and preserve uncommitted edits within blocks. It MUST NOT modify the document before a confirmed drop. It MUST cancel safely if the document changes during dragging, the pointer is canceled or lost, the window loses focus, the editor is destroyed, or the plugin is disabled.

#### Scenario: Moving a table being edited

- **WHEN** a user enters text in a table and starts moving the whole table
- **THEN** the input is saved safely before the updated complete table moves
- **AND** movement does not start if saving fails, and the input is not lost

#### Scenario: Cancellation or an editing-state change

- **WHEN** a user presses Esc, releases at an invalid destination, or an editing-state change requires cancellation
- **THEN** feedback is cleared and the interaction stops without a partial move or an extra undo entry
