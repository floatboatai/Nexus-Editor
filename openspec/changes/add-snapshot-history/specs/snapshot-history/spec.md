## ADDED Requirements

### Requirement: Manual Snapshot Creation

The electron demo SHALL allow the user to create a manual snapshot of the current editor document, capturing the full markdown content together with timestamped metadata.

#### Scenario: Create snapshot for a saved file
- **WHEN** a saved document is open in the editor
- **AND** the user triggers the snapshot action
- **THEN** a new snapshot entry SHALL be persisted for that document's file identity
- **AND** the snapshot SHALL include the full markdown content, a created-at timestamp, and a human-readable summary

#### Scenario: Create snapshot for an unsaved document
- **WHEN** the current document has no file path
- **AND** the user triggers the snapshot action
- **THEN** a new snapshot entry SHALL be persisted under the unsaved-document scope
- **AND** snapshot creation SHALL succeed without requiring the user to save first

### Requirement: Snapshot Listing

The electron demo SHALL let the user inspect recent snapshots for the currently active document in reverse chronological order.

#### Scenario: Show newest snapshot first
- **WHEN** the active document has multiple snapshots
- **THEN** the history panel SHALL render the newest snapshot before older ones

#### Scenario: Empty history state
- **WHEN** the active document has no snapshots
- **THEN** the history panel SHALL show a clear empty state
- **AND** the absence of snapshots SHALL NOT be treated as an error

### Requirement: Snapshot Restore

The electron demo SHALL allow the user to restore a selected snapshot into the current editor session.

#### Scenario: Restore snapshot into a clean editor
- **WHEN** the user selects `Restore` on a snapshot
- **AND** the current editor session is not dirty
- **THEN** the editor content SHALL be replaced with the snapshot content
- **AND** the restored document SHALL remain associated with the current file path when one exists

#### Scenario: Restore snapshot with unsaved changes
- **WHEN** the user selects `Restore` on a snapshot
- **AND** the current editor session is dirty
- **THEN** the app SHALL prompt for confirmation before replacing the document
- **AND** declining the prompt SHALL leave the current editor content unchanged

### Requirement: Snapshot Reuse as New Draft

The electron demo SHALL allow the user to reuse a selected snapshot as a new unsaved draft rather than overwriting the current file session.

#### Scenario: Reuse snapshot clears active file association
- **WHEN** the user selects `Reuse` on a snapshot
- **THEN** the snapshot content SHALL be loaded into the editor
- **AND** the current renderer state SHALL no longer point at an active file path
- **AND** the document SHALL be marked dirty so the user can choose a save destination explicitly

### Requirement: Snapshot Persistence

Snapshot history SHALL persist across electron-demo app restarts using host-managed local storage.

#### Scenario: Snapshot available after relaunch
- **WHEN** the user creates a snapshot and closes the app
- **AND** the app is launched again later
- **THEN** the snapshot SHALL still appear in the history list for the same document identity

#### Scenario: Corrupt snapshot store fallback
- **WHEN** the persisted snapshot storage file cannot be parsed
- **THEN** the app SHALL fall back to an empty snapshot store
- **AND** snapshot listing SHALL remain functional for newly created entries

### Requirement: Bounded Retention

The electron demo SHALL retain only a bounded number of the most recent snapshots per document.

#### Scenario: Oldest snapshot is dropped after reaching the cap
- **WHEN** the number of snapshots for one document exceeds the configured retention cap
- **THEN** the oldest snapshot SHALL be removed from persisted storage
- **AND** the newest snapshots SHALL be preserved
