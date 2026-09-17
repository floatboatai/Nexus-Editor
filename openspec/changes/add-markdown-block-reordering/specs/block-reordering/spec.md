## ADDED Requirements

### Requirement: Optional outermost block movement

The plugin SHALL move one complete supported outermost Markdown block between top-level block boundaries, in both source and live-preview modes. Nested content SHALL remain attached to its outer container. Unsupported nodes SHALL remain intact and SHALL NOT be offered as movement sources.

#### Scenario: Move a list containing nested content
- **WHEN** a user moves an outermost list containing nested items and task markers
- **THEN** the entire list SHALL move as one block
- **AND** the original list text, indentation, markers, and nested structure SHALL be retained

#### Scenario: Move a heading or image paragraph
- **WHEN** the source is a heading or a paragraph containing an image
- **THEN** only that complete outermost block SHALL move
- **AND** later section blocks SHALL NOT implicitly move with a heading

#### Scenario: Unsupported or incomplete source
- **WHEN** the source is an unsupported node or a complete document parse is unavailable within the reading budget
- **THEN** the plugin SHALL NOT construct a move from that source
- **AND** the document SHALL remain unchanged

### Requirement: Source-preserving validated transactions

The planner SHALL retain original block text and existing separator whitespace, adding blank lines only when needed to preserve structure. Before dispatch it SHALL verify the complete reordered tree, including nested structure, at both removal and insertion boundaries. Invalid, stale, no-op, or over-budget plans SHALL produce no document change.

#### Scenario: Removal would merge two lists
- **WHEN** removing a paragraph would join independent lists into one parsed list
- **THEN** the move SHALL be rejected if whitespace alone cannot preserve the original blocks
- **AND** no partial deletion or insertion SHALL be applied

#### Scenario: Insertion would reinterpret a thematic break
- **WHEN** the original separators would make a moved thematic break become a setext heading
- **THEN** the planner SHALL add the required blank separator if the full tree can otherwise be preserved
- **AND** it SHALL retain all original block text

#### Scenario: Snapshot becomes stale
- **WHEN** the document changes after pointer capture or supplied block ranges no longer describe the current document
- **THEN** the pending move SHALL be cancelled or rejected
- **AND** it SHALL NOT apply old offsets to the new document

### Requirement: Pointer gesture lifecycle

The plugin SHALL expose a focusable margin handle with source and valid-destination feedback. It SHALL start a drag only after the pointer crosses the activation threshold, scroll near the editor's vertical edges, and commit at most once on valid release. It SHALL cancel on Escape, pointer cancellation, lost capture, window blur, document changes, read-only transition, or plugin disposal.

#### Scenario: Release at a valid destination
- **WHEN** a mouse drag crosses the threshold and ends at a valid gap inside the editor
- **THEN** the document SHALL remain unchanged until release
- **AND** one validated move SHALL be dispatched

#### Scenario: Cancel or release outside
- **WHEN** the user cancels the gesture or releases outside the editor
- **THEN** no move SHALL be dispatched
- **AND** pointer capture, drag feedback, and auto-scroll work SHALL be released

#### Scenario: Touch or active composition
- **WHEN** the initiating pointer is touch or an editor composition is active
- **THEN** the plugin SHALL NOT begin a block move

### Requirement: Host-owned runtime commands

The lifecycle plugin SHALL register movement commands with the host command service and SHALL NOT install duplicate global CodeMirror movement bindings. Availability checks SHALL be free of document changes. Command execution SHALL resolve the current editor context and honor user binding overrides, cleared bindings, conflicts, and resource ownership.

#### Scenario: User clears or rebinds a shortcut
- **WHEN** the user clears or replaces a default movement binding
- **THEN** the removed default key SHALL NOT invoke a hidden local binding
- **AND** the command SHALL remain available through valid host command entry points

#### Scenario: Conflicting commands
- **WHEN** another command has the same effective movement shortcut
- **THEN** the host's conflict decision SHALL remain authoritative
- **AND** the plugin SHALL NOT independently execute through a second keymap

#### Scenario: Disable, re-enable, or detach
- **WHEN** the plugin is disabled or an editor detaches
- **THEN** its gestures, view mapping, handles, and applicable commands SHALL be released
- **AND** re-enabling SHALL NOT duplicate resources or discard persisted hotkey preferences

### Requirement: Atomic movement history and selection

A successful move SHALL be one isolated history transaction when history support is installed. The transaction SHALL carry movement origin metadata, map all selection ranges, and keep source and stationary boundary cursors attached to their content.

#### Scenario: Undo after typing and movement
- **WHEN** the user types and then moves a block
- **THEN** one undo SHALL restore the document and selection immediately before the move
- **AND** earlier typing SHALL remain until a separate undo

#### Scenario: Multiple cursor ranges
- **WHEN** one block moves while several selection ranges exist
- **THEN** ranges in the moved source SHALL follow that source
- **AND** other ranges SHALL map through the movement while retaining the main selection

#### Scenario: Host rejects the move
- **WHEN** the transaction pipeline rejects the movement transaction
- **THEN** no move history entry SHALL be created
- **AND** the plugin SHALL report that the block could not be moved
