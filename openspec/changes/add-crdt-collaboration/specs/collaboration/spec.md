## ADDED Requirements

### Requirement: Host-owned collaborative documents
The editor SHALL initialize from a host-owned attached plain-text Y.Text without
seeding or destroying that document and without requiring a network provider.

#### Scenario: Joining an existing room
- **WHEN** an editor joins a replicated document containing Markdown
- **THEN** it displays that document without inserting a second copy

### Requirement: Concurrent convergence
The binding SHALL translate accepted local edits into CRDT operations and apply
remote deltas without feedback, including after offline concurrent editing.

#### Scenario: Reordered and duplicate messages
- **WHEN** disconnected replicas edit and later exchange reordered duplicate updates
- **THEN** all replicas and their editor projections converge without lost operations

### Requirement: Selective undo
Each editor SHALL undo only its own operations and restore selections using
relative positions. Public API, keyboard and beforeinput history SHALL agree.

#### Scenario: Remote changes between edit and undo
- **WHEN** one editor undoes its edit after a peer inserts text
- **THEN** the peer's insertion remains and redo restores only the local edit

### Requirement: Remote transaction authority
Committed remote operations SHALL bypass local veto/rewriting filters while
notifying editor change callbacks and transaction observers.

#### Scenario: Local filter rejects typing
- **WHEN** a local filter rejects edits and a remote update arrives
- **THEN** local typing remains rejected and the remote update still appears

### Requirement: Collaboration presence and ownership
Optional awareness SHALL render relative remote cursors safely. Destroying an
editor SHALL remove its listeners, history and cursor without destroying
host-owned document or awareness state.

#### Scenario: Repeated mounting
- **WHEN** editors are repeatedly created and destroyed with the same host resources
- **THEN** no binding-owned listeners or cursors remain after destruction

### Requirement: Safe live preview
Collaborative live preview SHALL edit tables through Markdown transactions,
without enabling deferred contentEditable cell changes.

#### Scenario: Remote edits to a focused table
- **WHEN** a peer changes a table while another editor is editing its source
- **THEN** both edits participate in CRDT synchronization without stale cell commits
