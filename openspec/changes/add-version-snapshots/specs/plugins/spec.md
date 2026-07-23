## ADDED Requirements

### Requirement: Version Snapshots Scope

`@floatboat/nexus-plugin-snapshots` SHALL provide document version history as the reference implementation of Roadmap #19 ("Version history / snapshots"). This change SHALL cover full-document snapshot capture, per-document listing, restore, deletion, and retention. Diff / comparison UI, cloud sync, and changes to `packages/core` SHALL remain follow-up work outside this PR.

#### Scenario: Plugin-based first stage
- **WHEN** a host adds `createSnapshotsPlugin()` to `createEditor({ plugins })`
- **THEN** the host SHALL be able to capture, list, restore, and delete full-document snapshots
- **AND** `packages/core` public API SHALL remain unchanged

#### Scenario: Diff UI remains a follow-up
- **WHEN** a reviewer evaluates this change against Roadmap #19
- **THEN** the proposal SHALL identify diff / comparison UI and cloud sync as non-goals
- **AND** those behaviors SHALL NOT be required for this PR to be complete

### Requirement: Opt-In Backward Compatibility

Version snapshots SHALL be opt-in. Hosts that do not install the plugin SHALL see no change in editor behavior, and no snapshot data SHALL be written anywhere by default.

#### Scenario: No plugin, no snapshots
- **WHEN** a host creates an editor without `createSnapshotsPlugin()`
- **THEN** no snapshot storage SHALL be read or written
- **AND** editor behavior SHALL be unchanged

#### Scenario: Default in-memory storage
- **WHEN** a host creates `createSnapshotsPlugin()` without a `store`
- **THEN** snapshots SHALL be kept in memory only
- **AND** the plugin SHALL NOT write to global `localStorage`, the filesystem, or any other implicit persistence

### Requirement: Host-Injected Persistence

The plugin SHALL support host-injected async storage via a `SnapshotStore` interface (`list` / `load` / `save` / `remove` / `clear`). Persistent storage must be provided explicitly by the host.

#### Scenario: Host store persists snapshots
- **GIVEN** the host provides a `SnapshotStore`
- **WHEN** a snapshot is captured
- **THEN** the plugin SHALL write the snapshot content and metadata (id, createdAt, label) through the store under the current document key

#### Scenario: Snapshot survives reload
- **GIVEN** a host store that persists data across editor instances
- **WHEN** a snapshot was captured by a previous editor instance
- **THEN** a new plugin instance bound to the same store and document key SHALL list and restore that snapshot

### Requirement: Snapshot Capture Rules

Capture SHALL record the current document with an optional trimmed label. Consecutive snapshots with identical content SHALL be de-duplicated by content hash: if the newest snapshot for the document has the same content, capture SHALL be a no-op. Snapshots SHALL be scoped per document key supplied by the host's `getDocumentKey()`.

#### Scenario: Manual capture via command
- **GIVEN** the plugin is attached to an editor
- **WHEN** the host runs the `snapshots.capture` editor command
- **THEN** a snapshot of the current document SHALL be recorded

#### Scenario: Identical content is not re-captured
- **GIVEN** a snapshot of the current document already exists as the newest entry
- **WHEN** capture runs again without any document change
- **THEN** no new snapshot SHALL be created

#### Scenario: Changed content produces a new snapshot
- **GIVEN** the newest snapshot contains "alpha"
- **WHEN** the document changes to "alpha beta" and capture runs
- **THEN** a new snapshot SHALL be created and listed as the newest entry

#### Scenario: Labels are trimmed and blank labels are dropped
- **WHEN** capture is called with the label `"  before refactor  "`
- **THEN** the stored label SHALL be `"before refactor"`
- **WHEN** capture is called with a whitespace-only label
- **THEN** the snapshot SHALL be stored with no label

#### Scenario: Document keys isolate snapshot lists
- **GIVEN** snapshots exist for document key "a.md"
- **WHEN** the host's `getDocumentKey()` returns "b.md"
- **THEN** listing SHALL return only snapshots for "b.md"
- **AND** capturing SHALL write under "b.md"

#### Scenario: Idle auto-capture
- **GIVEN** `autoCapture.intervalMs` is configured
- **WHEN** the document changes and then remains idle for the interval
- **THEN** exactly one snapshot SHALL be captured
- **AND** continued typing SHALL reset the idle timer before it fires

### Requirement: Snapshot Retention

Each document key SHALL retain at most `maxSnapshots` snapshots (default 50). When the cap is exceeded, the oldest snapshots SHALL be removed first. When `maxAgeMs` is configured, snapshots older than that age SHALL be pruned lazily — on capture and when the host calls `prune()` — rather than by a background timer.

#### Scenario: Oldest snapshots are dropped
- **GIVEN** `maxSnapshots` is `2`
- **WHEN** three snapshots with different content are captured in order
- **THEN** only the two newest snapshots SHALL remain listed

#### Scenario: Expired snapshots are pruned on capture
- **GIVEN** `maxAgeMs` is configured and a snapshot older than that age exists
- **WHEN** a new snapshot is captured
- **THEN** the expired snapshot SHALL be removed

#### Scenario: Startup sweep without a new capture
- **GIVEN** `maxAgeMs` is configured and only expired snapshots exist
- **WHEN** the host calls `prune()` (e.g. at app startup)
- **THEN** the expired snapshots SHALL be removed without capturing anything new

### Requirement: Safe Restore

Restore SHALL replace the editor document through `EditorAPI.setDocument()` so the restore itself is undoable. Before replacing the document, the plugin SHALL capture a safety snapshot of the current content — skipped when the current content is already preserved (identical to the restore target, or identical to the newest snapshot via de-duplication). Restoring a missing or deleted snapshot id SHALL be a no-op.

#### Scenario: Restore replaces the document
- **GIVEN** a snapshot with content "alpha" and a current document "beta"
- **WHEN** the snapshot is restored
- **THEN** the editor document SHALL become "alpha"

#### Scenario: Safety snapshot before restore
- **GIVEN** a snapshot with content "alpha" and a current document "beta"
- **WHEN** the snapshot is restored
- **THEN** a new snapshot containing "beta" SHALL exist
- **AND** restoring that safety snapshot SHALL bring back "beta"

#### Scenario: No safety snapshot when content matches
- **GIVEN** the current document is identical to the snapshot being restored
- **WHEN** restore runs
- **THEN** no additional snapshot SHALL be created

#### Scenario: Missing snapshot id is a no-op
- **WHEN** restore is called with an id that does not exist in the store
- **THEN** the editor document SHALL be unchanged
- **AND** no error SHALL be thrown

### Requirement: Storage Failure Resilience

The plugin SHALL treat unavailable storage, thrown store operations, and missing snapshot ids as recoverable conditions. These failures SHALL NOT crash the editor or leave the plugin in a state where later operations fail.

#### Scenario: Store save throws
- **GIVEN** the host store rejects on `save`
- **WHEN** capture runs
- **THEN** the editor SHALL NOT throw
- **AND** subsequent captures against a healthy store SHALL still succeed

#### Scenario: Store list throws
- **GIVEN** the host store rejects on `list`
- **WHEN** the host lists snapshots
- **THEN** the call SHALL resolve with an empty list
- **AND** the editor SHALL continue to operate normally

### Requirement: Electron Demo Reference Implementation

The electron-demo SHALL provide the reference implementation of Roadmap #19: a file-backed `SnapshotStore` exposed over IPC, a snapshots panel for the active file, and capture-on-save. Snapshots SHALL be stored inside the vault under `.nexus/snapshots/`, and the vault file tree SHALL exclude dot-directories so snapshot storage stays invisible.

#### Scenario: Snapshots persist on disk
- **GIVEN** a vault is open in the electron-demo
- **WHEN** the user captures a snapshot of the active file
- **THEN** the snapshot content and metadata SHALL be written under `<vault>/.nexus/snapshots/`
- **AND** reopening the vault SHALL list the snapshot again

#### Scenario: Snapshot storage is invisible in the vault tree
- **WHEN** snapshot files exist under `<vault>/.nexus/snapshots/`
- **THEN** the vault panel tree SHALL NOT show `.nexus` or its contents
- **AND** the link index SHALL NOT index snapshot files

#### Scenario: Panel lists, restores, and deletes
- **GIVEN** the snapshots panel is open for the active file
- **WHEN** the user selects a snapshot and confirms restore
- **THEN** the editor document SHALL be replaced with the snapshot content
- **WHEN** the user deletes a snapshot
- **THEN** it SHALL disappear from the list and from disk

#### Scenario: Capture on save
- **WHEN** the user saves the active file to the vault
- **THEN** a snapshot SHALL be captured unless the content is unchanged since the newest snapshot
