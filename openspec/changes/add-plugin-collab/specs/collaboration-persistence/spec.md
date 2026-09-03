## ADDED Requirements

### Requirement: Browser Replicas survive reload through IndexedDB

The browser persistence adapter MUST implement the existing `ReplicaStore` seam using IndexedDB. Local-authority resume MUST restore committed updates before Provider startup. Remote-first create and authenticated-sync open MUST instead expose the checkpoint without applying cached updates, so Engine can preserve the cache on rejection or atomically replace it after remote validation. The adapter MUST append each accepted update transactionally, flush pending writes, compact to a snapshot without exposing a partial replacement, isolate documents by stable DocumentId, and fail explicitly on quota, corruption, blocked upgrade, or unavailable IndexedDB.

#### Scenario: Offline browser edit survives reload

- **WHEN** a participant edits while offline, flushes, destroys the Engine, and constructs a new Engine for the same DocumentId
- **THEN** the new Engine MUST restore the complete local Replica before network synchronization
- **AND** reconnecting MUST converge without duplicating the offline operation

#### Scenario: Lease and Store shutdown drain accepted writes

- **GIVEN** a lease has accepted an append operation
- **WHEN** lease or Store shutdown begins before that append settles
- **THEN** the append MUST settle before the database connection closes
- **AND** later lease operations MUST fail with a stable closed-store error
- **AND** reopening the Store MUST restore the accepted update

### Requirement: Electron persistence has one SQLite writer

The Electron Host MUST route all Replica Store operations through one Host-owned utility process using transferable message ports. That process MUST be the only SQLite connection owner for collaboration data, MUST use transactional append and snapshot replacement, and MUST identify each request by caller, document, operation, and sequence. Renderers MUST NOT receive filesystem paths, SQL access, or database credentials.

#### Scenario: Two renderers persist one document safely

- **WHEN** two renderer processes append updates for the same DocumentId concurrently
- **THEN** the utility process MUST serialize them into one valid journal
- **AND** both renderers MUST observe completion or a stable failure without opening SQLite themselves

#### Scenario: Utility process is unavailable

- **WHEN** the runtime lacks the required built-in SQLite capability or the utility process exits
- **THEN** the Host MUST report persistence failed and prevent a false durable claim
- **AND** MUST either restart and reconcile the broker or require an explicit user recovery action

#### Scenario: Utility shutdown drains renderer-to-worker transit

- **GIVEN** a renderer Store operation has returned from `postMessage` but has not yet reached the utility broker
- **WHEN** application shutdown reaches the worker through its independent parent channel
- **THEN** the worker MUST establish a same-MessagePort FIFO drain barrier before disconnecting leases or SQLite
- **AND** the preload bridge MUST stop accepting new operations and drain operations already queued above the MessagePort before acknowledging that barrier
- **AND** every operation accepted before that barrier MUST settle before successful shutdown acknowledgement
- **AND** a missing drain or worker cleanup acknowledgement MUST fail shutdown with a stable unknown-outcome diagnostic rather than treating exit code zero as proof of durability

### Requirement: Persistence acknowledgements have precise meaning

The Engine MUST report local persistence separately from transport, initial synchronization, remote authorization, and server persistence. `clean` MAY be reported only after the selected Store confirms every update through the current Replica revision; closing a document MUST await `flush` or return an explicit failure.

#### Scenario: Network success does not hide a local store failure

- **WHEN** the Provider is synchronized but a local append fails
- **THEN** transport and sync MAY remain healthy while persistence becomes failed
- **AND** the user-facing workflow MUST warn that local crash recovery is not guaranteed

#### Scenario: Strict join replaces a divergent durable cache

- **GIVEN** authenticated-sync open has loaded a Store checkpoint without applying its cached updates
- **WHEN** the Provider completes authenticated initial synchronization and the remote schema is valid
- **THEN** the Engine MUST atomically replace the Store through that checkpoint with a complete remote snapshot and flush it
- **AND** replacement or flush failure MUST fail strict readiness with `store-failed` rather than exposing the document or reporting clean persistence
