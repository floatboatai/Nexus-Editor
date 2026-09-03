## ADDED Requirements

### Requirement: Real clients synchronize through an authenticated network Provider

The system MUST provide a browser-capable WebSocket Provider adapter that connects independent processes or devices to a collaboration server through the existing `CollaborationProviderFactory` seam. The adapter MUST complete the provider protocol's initial synchronization before reporting `synced`, MUST exchange document and Awareness updates without exposing raw vendor objects, and MUST implement bounded reconnect and idempotent release.

#### Scenario: Independent clients converge through the server

- **WHEN** two Engines in independent client contexts open the same authorized DocumentId through the real Provider
- **THEN** accepted edits and Presence from either client MUST reach the other through the server
- **AND** both documents MUST converge after concurrent edits, reconnects, duplicate delivery, and server restart

### Requirement: Authentication and document authorization are enforced before updates

Every network connection MUST present an expiring signed credential scoped to a user, DocumentId, and access level. The server MUST reject malformed, expired, wrong-document, and invalid-signature credentials before applying updates. Read-only participants MUST receive document updates but MUST NOT mutate document state. The client snapshot MUST distinguish authentication, read-only, read-write, expired, and denied states, and a non-writable state MUST reject Local Proposals before they enter Yjs.

#### Scenario: Read-only participant cannot write

- **GIVEN** a participant has a valid read-only credential
- **WHEN** the participant attempts a local edit
- **THEN** the local proposal MUST be rejected without changing its Replica or any remote Replica
- **AND** the participant MUST continue receiving authorized remote updates
- **AND** a divergent durable cache MUST NOT be offered to the server during an invitation join or displayed as synchronized state

#### Scenario: Expired or wrong-document credential fails closed

- **WHEN** a client presents an expired credential or a credential scoped to another DocumentId
- **THEN** the server MUST terminate or deny the connection before accepting document or Presence updates
- **AND** the client MUST expose a stable denied or expired diagnostic rather than `synced`

#### Scenario: Delegated invitation cannot outlive its authority

- **GIVEN** an authenticated editor credential with less remaining lifetime than a requested invitation
- **WHEN** the participant requests a delegated credential for the same DocumentId
- **THEN** the server MUST reject the request without issuing a credential
- **AND** the Host MUST present a non-secret reauthentication action rather than weakening the expiry boundary

#### Scenario: Runtime revocation is linearized with admitted updates

- **GIVEN** a writer update has passed its initial authorization check but has not yet mutated the authoritative document
- **WHEN** revocation of that writer's credential completes first
- **THEN** the admitted update MUST observe the durable revocation and MUST NOT mutate the authoritative document afterward
- **AND** when the update owns the authorization turn first, revocation MUST wait for that update to finish before returning
- **AND** revocation or update failure MUST release the turn without deadlocking the room
- **AND** unrelated credentials and documents MUST continue to make progress

#### Scenario: Runtime revocation cannot be followed by stale Presence

- **GIVEN** an Awareness update has passed its initial authorization check but has not yet mutated server Presence
- **WHEN** revocation of that participant's credential completes first
- **THEN** the admitted Awareness update MUST observe the durable revocation and MUST NOT recreate Presence afterward
- **AND** when Awareness applies first, revocation MUST remove that connection's Presence before returning

#### Scenario: Revoked reader cannot receive a late synchronization snapshot

- **GIVEN** a read-only SyncStep1 request has passed its initial authorization check but has not yet encoded or sent authoritative document state
- **WHEN** revocation of that reader's credential completes first
- **THEN** the admitted request MUST observe the durable revocation and MUST NOT encode or send a document snapshot afterward
- **AND** normal read-only synchronization MUST remain non-mutating
- **AND** unrelated readers and documents MUST continue to synchronize

### Requirement: The reference server persists authoritative document state durably

The repository MUST include a runnable reference server whose persistence adapter atomically stores and restores the exact Yjs binary state per DocumentId. A process restart MUST not lose acknowledged state. Corrupt or unreadable state MUST fail explicitly rather than appearing as a new empty document. The server MUST expose a bounded health/readiness signal and release rooms and storage resources deterministically.

#### Scenario: Server restart preserves a document

- **WHEN** an authorized edit has completed server persistence and the server process is stopped and restarted
- **THEN** a newly connecting client MUST receive the acknowledged document state
- **AND** the server MUST NOT seed a second history or duplicate Markdown

#### Scenario: Corrupt server state does not become an empty room

- **WHEN** persisted bytes for a DocumentId cannot be decoded or validated
- **THEN** the server MUST fail that document with a diagnostic
- **AND** MUST NOT overwrite the persisted bytes or initialize a replacement empty document

#### Scenario: Expired revocations are durably pruned

- **GIVEN** the file revocation store contains time-bounded records
- **WHEN** records are already expired at load time or expire while the server is running
- **THEN** the store MUST remove them before its next atomic persistence result is exposed
- **AND** cleanup MUST NOT lose concurrent active revocations or retain expired records across restart

### Requirement: Network inputs and resources are bounded

The Provider and reference server MUST bound credential length, document identity, individual message size, cumulative encoded state retained per Collaborative Document, authenticated and unauthenticated pending message count and bytes, pending outbound data, reconnect delay, and shutdown time. The server-side document limit MUST be enforced before a writer update mutates the authoritative Yjs document and MUST use the same configured bound as durable snapshot persistence. Pre-authentication and established buffering MUST each have executable bounds; their handoff MAY temporarily retain both bounded sets, but MUST NOT exceed their configured sum. Logs and diagnostics MUST NOT include credentials or raw private document content.

#### Scenario: Oversized input is rejected safely

- **WHEN** a client supplies an oversized token, document name, frame, or pending queue
- **THEN** the responsible side MUST reject or close it with a stable diagnostic
- **AND** other documents and participants MUST remain available

#### Scenario: Individually valid updates cannot grow one room without bound

- **GIVEN** an authenticated writer sends many updates that are each smaller than the message limit
- **WHEN** accepting the next update would make the complete encoded Yjs state exceed the configured document limit
- **THEN** the server MUST reject that update before applying it and close the responsible document connection with a stable non-secret reason
- **AND** the last accepted state MUST remain persistable within the same limit
- **AND** server health and unrelated rooms MUST remain available

#### Scenario: Authenticated burst cannot create unbounded work

- **GIVEN** an authenticated participant has a document connection
- **WHEN** pending inbound messages exceed either the configured message-count or byte budget
- **THEN** the server MUST close that document connection with a stable non-secret reason before admitting the excess message
- **AND** already admitted document work MUST remain bounded
- **AND** health probes and unrelated rooms MUST continue to make progress
