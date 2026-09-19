# Editor Core Spec

## ADDED Requirements

### Requirement: setDocument undo history boundary

`editor.setDocument(next, opts?)` SHALL accept `opts.history` with the values `"record"`, `"skip"`, and `"reset"`. The option SHALL default to `"record"`, which keeps the whole-document replacement undoable exactly as before this change.

- `"record"` — the replacement SHALL produce one undo entry.
- `"skip"` — the replacement SHALL NOT be recorded as an undo entry. Previously recorded entries SHALL remain undoable, and the changed positions SHALL still be mapped through the replacement.
- `"reset"` — the replacement SHALL NOT be recorded as an undo entry AND the undo and redo stacks SHALL be cleared, so no history entry before the load can be reached in either direction.

`opts.history` SHALL be independent of `opts.silent`; either may be used without the other. When no CodeMirror history extension is installed, `opts.history` SHALL be accepted without throwing and the document content SHALL still be replaced.

#### Scenario: default replacement stays undoable
- **GIVEN** an editor with the history extension, initial content `"start"`, and no prior edits
- **WHEN** `setDocument("next")` is called without `opts.history`
- **THEN** `undo()` SHALL return `true`
- **AND** `getDocument()` SHALL return `"start"`

#### Scenario: skip is not recorded but keeps earlier entries undoable
- **GIVEN** an editor with the history extension whose content is `"A"`
- **WHEN** `setDocument("B", { history: "skip" })` is called and then `setDocument("C", { history: "record" })` is called
- **THEN** one `undo()` SHALL return `true`
- **AND** `getDocument()` SHALL return `"B"`
- **AND** the next `undo()` SHALL return `false`, because the `"skip"` load created no entry

#### Scenario: undo cannot revert a reset load
- **GIVEN** an editor with the history extension whose content is `"A"`
- **WHEN** `setDocument("B", { history: "reset" })` is called
- **THEN** `undo()` SHALL return `false`
- **AND** `getDocument()` SHALL return `"B"`

#### Scenario: an edit after a reset load undoes back to the loaded content
- **GIVEN** an editor with the history extension whose content is `"A"`
- **WHEN** `setDocument("B", { history: "reset" })` is called and then `setDocument("B edited", { history: "record" })` is called
- **THEN** `undo()` SHALL return `true`
- **AND** `getDocument()` SHALL return `"B"`
- **AND** a second `undo()` SHALL return `false`

#### Scenario: reset clears the redo stack
- **GIVEN** an editor with the history extension whose content is `"A"` that has been replaced with `"B"` and then undone, so `"B"` sits on the redo stack
- **WHEN** `setDocument("C", { history: "reset" })` is called
- **THEN** `redo()` SHALL return `false`
- **AND** `getDocument()` SHALL return `"C"`

#### Scenario: reset without a history extension does not throw
- **GIVEN** an editor created without the history extension
- **WHEN** `setDocument("next", { history: "reset" })` is called
- **THEN** the call SHALL NOT throw
- **AND** `getDocument()` SHALL return `"next"`

#### Scenario: a reset load deferred by IME composition still applies
- **GIVEN** an editor with the history extension whose content is `"A"` and an active IME composition
- **WHEN** `setDocument("B", { history: "reset" })` is called while composition is active
- **THEN** the replacement SHALL be deferred until composition ends
- **AND** after composition ends `getDocument()` SHALL return `"B"`
- **AND** `undo()` SHALL return `false`
