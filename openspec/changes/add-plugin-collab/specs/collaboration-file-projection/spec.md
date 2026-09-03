## ADDED Requirements

### Requirement: Enrollment persists file and collaborative identities separately

The Host MUST durably associate a Host-scoped File Identity with a DocumentId and current source path. Rename or move MUST update the path without changing either stable identity. File deletion, collaboration leave, and remote-document deletion MUST remain separate explicit operations.

#### Scenario: Renamed file keeps the collaboration room

- **WHEN** an enrolled Markdown file is renamed or moved through the Host
- **THEN** later opens MUST resolve the original DocumentId
- **AND** no path value may be used to create a replacement room

#### Scenario: Forget removes only the matching Projection Base

- **WHEN** the user forgets an inactive Enrollment or explicitly abandons a pending creation
- **THEN** the Host MUST validate FileId, DocumentId, path, and metadata revision before deleting the Projection Base with compare-and-set
- **AND** the Enrollment mutation MUST compare the complete expected record and move it into a durable operation-id tombstone
- **AND** a failed metadata deletion MUST restore only that still-current tombstone and surface an actionable failure, never overwrite a concurrent rename
- **AND** a Workspace that is active, opening, or closing MUST reject the forget operation

### Requirement: Collaborative Markdown projects to disk atomically

A File Projection coordinator MUST observe Collaborative Document revisions and write Markdown using a Host adapter with optimistic version checks and atomic replacement. A successful write MUST record a Projection Base containing the exact Markdown, collaborative revision, file version, and operation identity. Its own watcher event MUST be recognized as an echo rather than imported as a new user edit.

#### Scenario: Collaborative edit becomes a durable Markdown file

- **WHEN** a synchronized Collaborative Document changes and its expected file version still matches
- **THEN** the Host adapter MUST first acquire a bounded same-Vault projection-write permit and, while holding it, re-read the exact Projection Base plus active Enrollment or pending creation identity from durable storage
- **AND** an active path deletion reservation, missing identity, tombstone, FileId/path/DocumentId mismatch, or stale Projection Base MUST reject the write before filesystem mutation
- **AND** the coordinator MUST atomically write the exact Markdown and advance the Projection Base
- **AND** the resulting watcher event MUST NOT create a duplicate CRDT operation
- **AND** the permit MUST be released on success or failure; an abandoned permit MUST expire without interrupting a filesystem call already admitted under it

#### Scenario: Deleted enrollment cannot be resurrected by a stale projection

- **GIVEN** another renderer deleted an Enrollment and Projection Base and released its path reservation
- **WHEN** an older active projection receives a later Collaborative Document revision, including after the main-process in-memory fence restarted
- **THEN** its fresh Host permit MUST NOT substitute for missing durable identity authority
- **AND** the adapter MUST reject before recreating or modifying the Markdown path

#### Scenario: Invitation projection is fenced until Enrollment commit

- **WHEN** an invitation join projects before its Enrollment exists
- **THEN** every projection write MUST carry the exact Host committed opening whose immutable recovery owner matches the durable original sender/session and whose current holder matches the calling sender/session, for the same Vault, path, operation, and DocumentId
- **AND** durable pending-join identity MUST exist before the first Projection metadata or filesystem write
- **AND** a wrong-owner, expired, released, or mismatched DocumentId opening MUST fail before disk I/O
- **AND** capability expiry or renderer/session close MUST revoke the holder without removing the blocking fence
- **AND** only exact durable recovery MAY rebind or release that fence

#### Scenario: File write succeeds before Projection Base confirmation

- **GIVEN** File Projection has already persisted exact FileId/path/DocumentId metadata with a null Base
- **WHEN** atomic Markdown write succeeds and the renderer stops before the new Base metadata save
- **THEN** restart recovery MUST retain and recognize that exact identity rather than treating the file as unwritten
- **AND** it MAY complete the exact Enrollment without another file write
- **AND** later no-Base reconciliation MUST remain explicit

#### Scenario: Watcher changes are ordered after the initial projection read

- **WHEN** a change or rename is observed while File Projection is still reading its initial path
- **THEN** the watcher MUST buffer that event until the initial read and reconciliation finish
- **AND** it MUST then process the event in arrival order against the resulting Projection Base
- **AND** a late old-path read MUST NOT confirm metadata or a file version for the renamed path

#### Scenario: Collaborative changes are ordered after the initial projection read

- **WHEN** the Collaborative Document changes while File Projection is still reading its initial path
- **THEN** the initial read and reconciliation MUST remain the head of the projection operation queue
- **AND** the Collaborative Document change MUST reconcile afterward against the Projection Base established from the initially observed document revision
- **AND** initialization and the queued change MUST NOT issue concurrent reads or writes that can confirm incompatible file versions

### Requirement: External file changes use three-way reconciliation

External Markdown MUST be compared using Projection Base, current Collaborative Document, and incoming file content. A one-sided change MUST be applied automatically. Independently changed non-overlapping regions MAY be merged deterministically. Overlapping or base-less divergent changes MUST enter an explicit File Conflict and MUST stop automatic projection until resolved.

#### Scenario: Non-overlapping external and collaborative edits merge

- **GIVEN** a valid Projection Base
- **WHEN** the live Collaborative Document and external file modify non-overlapping base regions
- **THEN** the coordinator MUST produce one deterministic merged Markdown value
- **AND** apply it once to the Collaborative Document and File Projection

#### Scenario: Overlapping edits become a conflict

- **WHEN** live and incoming Markdown make incompatible changes to the same base region
- **THEN** neither side may silently overwrite the other
- **AND** the workflow MUST expose base, live, incoming, and supported resolution actions

### Requirement: Conflict resolution is explicit and recoverable

The Host MUST allow the user to keep live content, accept disk content, or supply manually merged Markdown. Resolution MUST verify the conflict generation and current file version before changing either authority; stale resolutions MUST be rejected and re-evaluated.

#### Scenario: Manual resolution closes the matching conflict

- **WHEN** the user submits manually merged Markdown for the current conflict generation
- **THEN** the coordinator MUST apply it as one intentional collaborative operation, atomically project it, and establish a new Projection Base
- **AND** stale automatic writes MUST not run afterward
