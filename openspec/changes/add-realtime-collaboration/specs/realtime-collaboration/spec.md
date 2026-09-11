# Realtime Collaboration Spec

## ADDED Requirements

### Requirement: Provider-neutral Yjs binding

The collaboration package SHALL bind one Nexus editor to a named `Y.Text` in a host-supplied `Y.Doc`. It MUST NOT create, connect, authenticate, persist, or depend on a concrete network provider. Hosts SHALL be able to attach any Yjs-compatible provider to the document without changing the Nexus editor integration.

#### Scenario: Host replaces the network provider
- **WHEN** a host replaces one Yjs-compatible provider with another while supplying the same collaboration options to Nexus
- **THEN** the editor binding SHALL require no provider-specific URL, token, room, or class
- **AND** document synchronization SHALL continue to operate through the supplied `Y.Doc`

#### Scenario: Content-only collaboration without awareness
- **WHEN** the plugin receives a `Y.Doc` but no awareness implementation
- **THEN** Markdown synchronization SHALL work normally
- **AND** no presence or remote-caret capability SHALL be required

### Requirement: Shared Markdown is canonical

The shared `Y.Text` SHALL contain the canonical Markdown source verbatim. The plugin MUST NOT synchronize mdast, HTML, preview DOM, decorations, or widget state as durable collaborative document data. On binding initialization, shared content SHALL be authoritative, and the plugin MUST NOT automatically append each editor's `initialValue` to an empty shared document.

#### Scenario: Two clients join an empty shared document
- **WHEN** two clients bind to an empty shared `Y.Text` with non-empty local editor initial values
- **THEN** the plugin SHALL NOT automatically insert both local initial values
- **AND** the shared document SHALL remain empty until the host explicitly seeds or edits it

#### Scenario: Host seeds initial Markdown once
- **WHEN** the host calls the seed helper on an empty shared document
- **THEN** the helper SHALL insert the Markdown verbatim and report success
- **AND** a subsequent seed attempt on the non-empty document SHALL leave it unchanged and report that no seed occurred

### Requirement: Local edits synchronize incrementally

Every committed local document change SHALL be translated to the shared `Y.Text` within one Yjs transaction owned by that editor binding. The steady-state path MUST NOT replace the full shared text for an incremental editor change.

#### Scenario: User inserts text
- **WHEN** a user inserts text in a collaborative editor
- **THEN** the binding SHALL apply the equivalent insertion to `Y.Text` in one local-origin Yjs transaction
- **AND** other peers SHALL eventually receive the insertion exactly once

#### Scenario: Atomic plugin transaction contains multiple changes
- **WHEN** a Nexus plugin submits one atomic transaction containing multiple non-overlapping text changes
- **THEN** the collaboration binding SHALL preserve it as one Yjs transaction
- **AND** peers SHALL observe one coherent document transition rather than intermediate invalid Markdown

### Requirement: Remote edits enter the normal editor pipeline

Remote Yjs changes SHALL be translated into incremental Nexus/CodeMirror transactions. They SHALL carry the stable `collab:remote` origin, update the derived AST and Live Preview, and MUST NOT be broadcast back to Yjs as new local edits or added to the ordinary local undo history.

#### Scenario: Remote edit updates derived state
- **WHEN** a peer changes Markdown that affects a heading and inline formatting
- **THEN** the receiving editor SHALL update its Markdown, AST, table of contents, events, and Live Preview
- **AND** the editor instance SHALL not be recreated

#### Scenario: Remote update does not echo
- **WHEN** a binding applies a remote Yjs transaction to its editor
- **THEN** that editor update SHALL NOT create a semantically duplicate Yjs transaction
- **AND** provider message counts SHALL become idle after all original updates are delivered

### Requirement: Concurrent edits converge

After all Yjs updates are eventually delivered, every peer bound to the same shared document SHALL have byte-identical Markdown and equivalent Yjs state regardless of message delay, ordering, duplication, temporary disconnection, or reconnection.

#### Scenario: Concurrent insert and delete
- **WHEN** one offline peer inserts inside a range while another peer concurrently deletes an overlapping range
- **AND** both peers reconnect and all updates are delivered in different orders
- **THEN** every peer's Markdown SHALL converge byte-for-byte
- **AND** no update SHALL be lost or applied twice

#### Scenario: Randomized delivery schedule
- **WHEN** a seeded test generates concurrent edits and arbitrary valid delivery schedules across multiple peers
- **THEN** every completed run SHALL converge
- **AND** a failing seed SHALL be reported so it can be reproduced as a fixed regression test

### Requirement: Collaborative undo is local to the user

Undo and redo in a collaborative editor SHALL use a Yjs undo manager scoped to the local binding origin. A local undo MUST NOT remove changes authored only by another peer. Initialization and remote transactions MUST NOT enter the local collaborative undo stack.

#### Scenario: Undo after a remote edit
- **WHEN** user A inserts text, user B inserts different text, and both updates synchronize
- **AND** user A invokes collaboration undo
- **THEN** only user A's insertion SHALL be undone
- **AND** user B's insertion SHALL remain on every peer

#### Scenario: Reconnect preserves undo semantics
- **WHEN** a user edits offline, receives concurrent remote updates after reconnect, and then invokes undo
- **THEN** the user's latest undoable local operation SHALL be reverted
- **AND** synchronized remote edits SHALL remain intact

### Requirement: Awareness is optional, relative, and ephemeral

When awareness is supplied, the plugin SHALL publish the configured local user and selection and render valid remote selections/carets. Selection endpoints MUST use Yjs relative positions. Awareness data MUST NOT be persisted as Markdown, enter undo history, or block content synchronization when absent or malformed.

#### Scenario: Concurrent edit remaps a remote caret
- **WHEN** a remote caret is published and another peer inserts Markdown before it
- **THEN** the displayed caret SHALL remain attached to the corresponding collaborative position
- **AND** no durable document content SHALL be changed by that caret update

#### Scenario: Malformed awareness payload
- **WHEN** a peer publishes a missing, malformed, stale, or foreign-document selection payload
- **THEN** the plugin SHALL ignore that selection without throwing
- **AND** Markdown synchronization SHALL continue

### Requirement: Active interactions remain safe

Remote updates MUST NOT recreate the editor, interrupt or duplicate IME composition, clear an active table interaction, or leave event handlers referencing detached widget DOM. Updates that cannot be applied safely during an active interaction SHALL be queued and applied in Yjs order at the next safe commit point.

#### Scenario: Remote update during Chinese composition
- **WHEN** one user is composing Chinese text and a remote update arrives before `compositionend`
- **THEN** the candidate session SHALL remain active
- **AND** the composed text SHALL be committed exactly once
- **AND** both peers SHALL converge after the safe commit point

#### Scenario: Remote update during table drag
- **WHEN** a user is dragging a table row or column and a remote edit arrives
- **THEN** the drag's editing lock and DOM SHALL remain valid until mouseup
- **AND** the remote update SHALL eventually apply without losing either user's change

### Requirement: Binding lifecycle is leak-free and idempotent

Disposing the collaboration plugin or destroying its editor SHALL remove all Yjs observers, editor contributions, awareness publications, decorations, timers, and undo resources owned by that binding. Repeated disposal SHALL be safe, and no later provider update may mutate the disposed editor.

#### Scenario: Plugin is disabled while connected
- **WHEN** the host disposes an active collaboration binding
- **THEN** the editor content, selection, focus, and instance identity SHALL remain intact
- **AND** later Yjs updates SHALL not modify that editor
- **AND** other peers and provider connections owned by the host SHALL remain operational

#### Scenario: Repeated disposal
- **WHEN** disposal is requested more than once
- **THEN** every owned observer and resource SHALL be released at most once
- **AND** all disposal calls SHALL complete without duplicate side effects

### Requirement: Collaboration performance is bounded

Steady-state remote updates SHALL be applied as incremental changes. The implementation SHALL provide repeatable performance and soak tests for large Markdown documents, multiple peers, and sustained update traffic, and SHALL expose no monotonically growing owned-resource count after peers are destroyed.

#### Scenario: Single remote insertion in a large document
- **WHEN** a peer inserts one character into a 10,000-line shared Markdown document
- **THEN** the receiving editor SHALL apply an incremental transaction
- **AND** the collaboration layer SHALL NOT invoke full-document `setDocument()`

#### Scenario: Peer teardown after sustained editing
- **WHEN** multiple peers edit for the configured soak period and are then destroyed
- **THEN** collaboration-owned observer, timer, awareness, and contribution counts SHALL return to their baseline

