## ADDED Requirements

### Requirement: Collaboration is exposed through one headless Engine

The collaboration package MUST expose one browser-safe `CollaborationEngine` interface for create, open, inspect, subscribe, and close operations. The ordinary package entry MUST NOT depend on React, Vue, Electron, Node filesystem interfaces, plugin-runtime implementations, or a server-vendor SDK. Engine callers MUST NOT need to coordinate Yjs observers, Provider startup, Store restore, source readiness, history, Presence, or Registry ownership themselves.

#### Scenario: Direct Core caller uses the Engine

- **WHEN** a Host creates an Engine, opens or creates a Collaborative Document, and attaches an `EditorAPI`
- **THEN** editing and lifecycle behavior MUST work without installing plugin-runtime or a framework binding
- **AND** the caller MUST NOT receive a raw Y.Doc, Y.Text, Awareness instance, or provider-specific object

### Requirement: Document identity is stable and Host-owned

Every Collaborative Document MUST use an opaque `DocumentId` independent of file path, File Identity, Editor, window, process, and Provider room implementation. The Host MUST supply and persist its association with the Host document; the Engine MUST treat mismatched document metadata as an identity error rather than silently changing rooms.

#### Scenario: File context changes without changing collaboration identity

- **WHEN** a Host resolves the same DocumentId after a file rename or another Editor opens the document
- **THEN** the Engine MUST address the same Collaborative Document
- **AND** no path string may become the implicit room identity

### Requirement: Create and join are distinct operations

`create(ref, { initialMarkdown })` MUST be the only operation that seeds document content and MUST persist or observe a creation marker before reporting readiness. A durable create MUST load only the Store checkpoint and synchronize an empty Replica before applying any cached update or exposing it to the Provider. Once authenticated remote state is confirmed empty, it MUST checkpoint-replace the old cache before persisting the new creation state; authentication failure or an existing remote document MUST leave the old cache unchanged. `open(ref)` MUST NOT seed from Editor content, a file, an empty Store result, or an empty Y.Text. Its default readiness MAY accept a valid durable local Replica for explicitly enrolled offline recovery, while an invitation join MUST select authenticated Provider synchronization. Duplicate create and metadata mismatch MUST fail explicitly.

#### Scenario: Concurrent join never duplicates initial Markdown

- **WHEN** two callers open the same previously created DocumentId with no local Replica
- **THEN** both MUST wait for authoritative initial synchronization
- **AND** neither caller may insert its Editor initial value into the shared text

#### Scenario: Duplicate create fails closed

- **WHEN** create observes an existing creation marker for the DocumentId
- **THEN** it MUST return a structured already-created or identity error
- **AND** MUST NOT append the requested initial Markdown

#### Scenario: Durable create does not upload or destroy a stale cache before remote authority

- **GIVEN** the Store contains updates for the requested DocumentId
- **WHEN** create authenticates against an empty remote room
- **THEN** the Provider MUST first synchronize an empty Replica without receiving those cached updates
- **AND** the Engine MUST checkpoint-replace the cache before appending and flushing the new creation state
- **BUT WHEN** authentication fails or the remote room already exists
- **THEN** the Store MUST remain unchanged

### Requirement: Readiness protects authoritative content

A document handle MUST become ready only after a valid local Replica has been restored or a first join has completed authoritative initial synchronization. Editor attachment MUST await the same gate. `replace-editor` MUST explicitly authorize replacing an unused Editor projection; `require-match` MUST compare without overwriting and fail on mismatch.

An invitation-based join MUST require authenticated Provider initial synchronization even when the Store already contains a valid schema. A newly created strict-open Replica MUST load only the Store checkpoint, MUST NOT apply cached Yjs updates before synchronization, and MUST replace the cache with the authenticated remote snapshot before returning. Registry authority provenance is immutable: a Replica opened through local-first readiness or `create()` MUST NOT later satisfy a strict open and MUST reject it with `remote-authority-unavailable`. A rejected strict call MUST release only its reference and MUST NOT close a Replica held by another handle.

#### Scenario: First join does not expose a temporary empty document

- **WHEN** open has neither a valid local Replica nor completed initial synchronization
- **THEN** `whenReady()` and attach MUST remain pending or fail explicitly
- **AND** the Engine MUST NOT report the temporary Y.Text value as authoritative content

#### Scenario: Cached Replica does not bypass invitation authentication

- **GIVEN** the local Store contains a valid Replica for the invited ServerUrl and DocumentId
- **WHEN** an invitation join presents an invalid, wrong-document, expired, or revoked credential
- **THEN** authenticated-sync readiness MUST fail before File Projection, Enrollment, or Editor attachment
- **AND** any independently held local-first resume handle MUST remain valid until its owner closes it

#### Scenario: Valid invitation does not upload a stale join cache

- **GIVEN** the Store contains a divergent Replica for the invited ServerUrl and DocumentId
- **WHEN** a reader or editor invitation performs authenticated-sync open
- **THEN** initial synchronization MUST start from an empty client Replica and expose only the server-authoritative document
- **AND** the stale cache MUST NOT enter the Provider protocol or mutate server persistence
- **AND** the authenticated remote snapshot MUST atomically replace and flush the stale cache before the handle becomes ready

#### Scenario: Existing local authority cannot be upgraded in place

- **GIVEN** a Registry entry was opened through local-first readiness or `create()` and another handle still owns it
- **WHEN** a caller requests authenticated-sync readiness for the same DocumentId
- **THEN** the call MUST fail with `remote-authority-unavailable`
- **AND** the existing handle and Replica MUST remain open until their owner closes them

#### Scenario: Require-match preserves existing Editor content

- **WHEN** an Editor's Markdown differs from the ready Replica and attach uses `require-match`
- **THEN** attach MUST fail with both identities/revisions needed for diagnosis
- **AND** MUST NOT overwrite either Editor or Replica

#### Scenario: Editor attach is an atomic readiness fence

- **WHEN** a Local Proposal or remote Yjs update arrives while an Editor Binding is still installing
- **THEN** the Local Proposal MUST be rejected with a stable not-ready reason and change neither Editor nor Replica
- **AND** the Binding MUST observe the remote update and reconcile from the current Replica before enabling Local Proposals
- **AND** closing the document during installation MUST roll back every installed hook and reject the attach

### Requirement: A Registry owns one Replica per DocumentId and realm

Concurrent Engine operations for the same DocumentId in one JavaScript realm MUST share one opening operation and one Replica. Each returned document handle MUST remain independently closable. A closing Replica MUST NOT be reused as a newly opened Replica, and an old handle MUST NOT operate on a replacement generation.

#### Scenario: Concurrent opens share work but not handle lifetime

- **WHEN** two open calls for one DocumentId overlap
- **THEN** schema restore and Provider preparation MUST execute once for the shared Replica
- **AND** closing one handle MUST NOT close the document while the other handle remains active

### Requirement: The shared schema is versioned and validated

Each Replica MUST use `Y.Text("content")` for Markdown and `Y.Map("nexus:meta")` for schema version, DocumentId validation, and creation metadata. Unsupported future schema versions, missing required creation state, and DocumentId collision MUST fail before Provider updates or Editor attachment can modify the Replica.

#### Scenario: Unsupported schema fails before editing

- **WHEN** restore or initial synchronization reveals a schemaVersion newer than the implementation supports
- **THEN** the document MUST enter an explicit failed state before any Editor becomes writable
- **AND** unknown shared state MUST NOT be discarded or downgraded

### Requirement: Accepted Local Proposals enter Yjs exactly once

An attached Editor's ordinary transactions MUST remain Local Proposals and pass through Core filters. Only the final accepted/replaced commit MUST enter Y.Text under that Binding's stable local origin. Rejected proposals MUST change neither Y.Text nor any other attached Editor.

#### Scenario: Replaced local edit synchronizes only its replacement

- **WHEN** a Core filter replaces a Local Proposal and Core commits the replacement
- **THEN** the Binding MUST apply only the final replacement to Y.Text once
- **AND** every other Replica/Editor MUST converge on that replacement rather than the original proposal

### Requirement: Non-local Yjs changes project as Authoritative Updates

A Binding MUST translate Y.Text changes not produced by its own local origin into Core authoritative transactions. It MUST prevent observer/listener feedback loops while preserving EditorState, AST, selection mapping, events, and update listener visibility. An apply failure or post-commit mismatch MUST quarantine that Binding rather than rewrite Y.Text from the Editor.

#### Scenario: Remote update bypasses a rejecting local filter

- **GIVEN** an attached Editor has a filter that rejects every Local Proposal
- **WHEN** another Replica commits a valid Yjs update
- **THEN** the Binding MUST project it through the active authoritative source without invoking that filter
- **AND** Editor, AST, events, listeners, and Y.Text MUST agree afterward

#### Scenario: Projection mismatch enters Quarantine

- **WHEN** a Binding cannot prove its Editor Markdown equals Y.Text after an authoritative commit
- **THEN** it MUST stop accepting Local Proposals and publish a structured Quarantine diagnostic
- **AND** MUST NOT modify Y.Text to match the divergent Editor

### Requirement: Undo and Redo are local to each Binding

Every Editor Binding MUST own a distinct local origin and Y.UndoManager that tracks only changes created by that Binding. The Binding MUST supply that history controller when acquiring Core authority, so EditorAPI, keyboard, browser history input, and Host commands all use the same history. Remote changes and another local Binding's changes MUST NOT be removed by Undo.

Undo and Redo MUST pass through the same Binding lifecycle, requested-access, and current Provider authorization gate as ordinary Local Proposals. A rejected history action MUST return without mutating Yjs, the Editor projection, or the Store.

#### Scenario: Local undo preserves another participant's work

- **WHEN** two Bindings make interleaved changes and the first Binding invokes Undo
- **THEN** only the first Binding's most recent tracked operation MUST be undone
- **AND** the second Binding's operation MUST remain in every converged Replica and Editor

#### Scenario: Permission downgrade blocks history mutation

- **GIVEN** a Binding has local undo or redo history
- **WHEN** its membership or Provider access is downgraded to read-only
- **THEN** Undo and Redo MUST be rejected by the same write gate as an ordinary Local Proposal
- **AND** no Yjs update may be generated

### Requirement: Provider lifecycle is replaceable and truthful

The Engine MUST depend on a Nexus Provider factory/lease seam rather than a third-party SDK type. Preparation MUST NOT connect or mutate the supplied Replica. Start MUST occur after the shared schema is addressable. Local-authority resume MUST restore and observe the Store before start; remote-first create and authenticated-sync open MUST retain only the Store checkpoint and defer observation until the remote-authority decision can safely preserve or replace the old cache. State MUST distinguish transport connection from initial synchronization, and release MUST be idempotent without destroying Engine-owned Yjs objects.

#### Scenario: Socket-like connection is not reported as synchronized

- **WHEN** the assessment Provider establishes transport before completing its state-vector exchange
- **THEN** the snapshot MAY report transport online but MUST continue reporting sync in progress
- **AND** first-join attachment MUST remain behind the readiness gate

### Requirement: Missing durability is explicit

The Engine MUST accept a replaceable Replica Store seam and MUST report Store load, append, flush, and failure independently from Provider state. Running without durable persistence MUST require explicit `{ mode: "volatile" }` configuration and MUST expose `persistence="volatile"`; it MUST NOT report persisted, durable, or safely saved.

#### Scenario: Volatile assessment mode does not claim persistence

- **WHEN** a Host constructs the Engine with explicit volatile mode
- **THEN** editing and Provider synchronization MAY operate for the process lifetime
- **AND** every public snapshot and demo label MUST make the absence of crash recovery observable

### Requirement: Assessment adapters are isolated from the production entry

The PR MUST provide deterministic in-memory Provider and Store adapters sufficient for contract tests and the demonstration. These adapters MUST live under clearly named testkit or assessment exports, MUST have bounded queues and idempotent cleanup, and MUST NOT be documented as a production backend or imported automatically by the ordinary Engine entry.

#### Scenario: Consumer imports the default package entry

- **WHEN** a consumer imports the ordinary collaboration package entry
- **THEN** no assessment server, test scheduler, Electron interface, or Node-only module may initialize or enter the browser bundle

### Requirement: Presence is ephemeral, bounded, and non-authoritative

Presence MUST remain outside durable document state and MUST use relative positions for cursor/selection data. Local changes MUST be throttled and coalesced. Remote display fields MUST be type/length/format checked before rendering, and no Presence field may grant identity, membership, or authorization.

#### Scenario: Malicious remote display data is harmless

- **WHEN** Awareness contains HTML in a name, an unsafe avatar URL, an invalid color, or oversized metadata
- **THEN** the renderer MUST treat text as text and reject or normalize unsafe fields within configured bounds
- **AND** the payload MUST NOT alter document authorization or content

#### Scenario: Presence disappears without affecting content

- **WHEN** a Binding detaches, changes document, disconnects, expires, or the Engine closes
- **THEN** its cursor Presence MUST be removed by the defined active or timeout path
- **AND** document state and convergence MUST remain unchanged

### Requirement: Integration paths reuse the same Engine interface

Direct Core, React, Vue, and any native lifecycle adapter MUST attach through the same CollaborationEngine document handle. Framework packages MUST NOT own Replica state or duplicate synchronization logic. A native lifecycle adapter MUST translate only public Host attach/detach/context events and MUST attach only documents explicitly enrolled by the Host.

#### Scenario: Framework unmount uses ordinary Binding cleanup

- **WHEN** a React or Vue editor unmounts after attaching through its ready callback
- **THEN** it MUST detach the same Binding interface used by a direct Core caller
- **AND** no framework-specific Replica or Provider lifecycle may remain

### Requirement: The Electron demonstration is honest and disposable

The separate assessment lab inside the Electron demo MUST demonstrate at least two Editors or windows converging through the assessment adapter and MUST expose enough state to observe connection, synchronization, peers, and volatile persistence. That lab's visible documentation/UI MUST label the demonstration local and experimental and MUST NOT imply cloud storage, authentication, crash recovery, or production support; this restriction does not erase evidence-scoped capabilities of the separately identified real Host workflow.

#### Scenario: Reviewer exercises the collaboration demo

- **WHEN** the reviewer edits either demonstrated Editor after both are ready
- **THEN** the other Editor MUST converge and Presence MUST update as documented
- **AND** the demo MUST visibly disclose that closing the process may lose volatile state

### Requirement: Lifecycle cleanup is complete and idempotent

Binding detach, document-handle close, lifecycle adapter unload, Editor destruction, and Engine close MUST be idempotent. After the final owner closes, observers, timers, animation callbacks, event listeners, Presence state, Provider leases, Store leases, and Registry entries MUST return to the documented baseline without closing resources still owned by another handle.

If initialization fails, its stable opening diagnostic MUST remain the top-level error even when cleanup also fails. Cleanup failures MUST remain inspectable through an aggregate cause, and cleanup MUST still attempt the complete owned resource graph.

#### Scenario: Engine close releases the complete object graph

- **WHEN** an Engine with multiple documents, handles, Editors, and Presence entries closes more than once
- **THEN** every owned resource MUST be released exactly once in dependency order
- **AND** later handle operations MUST return stable closed/stale errors without side effects

#### Scenario: Direct Editor destruction detaches its Binding

- **GIVEN** an Editor has an active Binding and the Collaborative Document remains owned by another handle
- **WHEN** the Host destroys that Editor without first awaiting `binding.detach()`
- **THEN** the Binding MUST immediately stop proposals and remove its Y.Text observer, Presence, and Replica bookkeeping
- **AND** a later remote update MUST NOT invoke the destroyed Editor source or quarantine the remaining Replica
- **AND** asynchronous cleanup failures MUST be caught, aggregated, and reported without an unhandled rejection

### Requirement: Support status matches qualification evidence

The submitted capability MUST be labelled `experimental`. Contract tests and a working demo MUST NOT be described as production Provider, durable Store, cross-device, file reconciliation, security, performance, or long-running qualification. Stronger support language MUST remain blocked on the applicable qualification matrix gates.

#### Scenario: Final PR describes completion

- **WHEN** the final PR and README summarize the implemented collaboration capability
- **THEN** they MUST distinguish completed assessment requirements from deferred production qualification
- **AND** MUST NOT mark Roadmap #18 done or claim `production-supported`
