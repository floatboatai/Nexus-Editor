## ADDED Requirements

### Requirement: Alternative history backend
Core SHALL allow one CodeMirror history backend to override public undo and redo
without importing a CRDT library. Without a backend existing history SHALL remain
unchanged. An empty alternative history SHALL NOT fall back to positional undo.

#### Scenario: Collaborative history is empty
- **WHEN** the alternative backend returns false from undo
- **THEN** editor.undo returns false without attempting a different history

### Requirement: Replicated transaction projection
Core SHALL apply transactions annotated as remote without local veto or rewrite,
including batches consisting entirely of remote transactions, and SHALL notify
transaction observers after commit.

#### Scenario: Remote batch with a local veto
- **WHEN** an authoritative remote batch arrives while a local filter rejects edits
- **THEN** the batch commits and observers receive its final document and origins

### Requirement: Transactional table source mode
Live preview SHALL provide an opt-in source mode for tables while preserving the
existing editable table widget as the default.

#### Scenario: Source mode with other Markdown
- **WHEN** a document contains a table and a heading in source-table mode
- **THEN** the table remains Markdown source and the heading retains live preview
