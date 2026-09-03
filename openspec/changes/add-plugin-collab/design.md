## Context

Nexus currently treats every public transaction as a policy-controlled local proposal. `CoreEditorTransactionPipeline.commit()` runs registered filters before updating the Editor, `EditorAPI.undo()` and `redo()` are wired to CodeMirror history, and the live-preview table can retain contentEditable cell text outside EditorState until blur. Those properties are valid for a standalone Editor but can make an Editor diverge from a CRDT that has already committed a remote update.

The collaboration module must remain usable without React, Vue, Electron, plugin-runtime, a filesystem, or a specific server SDK. The first assessment slice established that Engine but left the only runnable path on an in-memory Provider and volatile Store. The completion slice keeps the Engine interface deep while adding real adapters, a deployable reference server, durable Host storage, File Projection, and a product workflow around it.

## Goals / Non-Goals

### Goals

- Deliver one end-to-end collaboration product slice across independent clients, a real server, durable local state, and real Markdown files.
- Keep Core unaware of Yjs, network, persistence, files, accounts, and frameworks.
- Give one owner an exclusive authoritative dispatch and history path for one Editor.
- Preserve existing Local Proposal filter behavior for every other caller.
- Expose one headless Engine interface to direct Core, React, Vue, and native lifecycle callers.
- Prove deterministic Yjs convergence, multi-Editor binding, local-only Undo, Presence, and cleanup.
- Preserve assessment adapters as deterministic test tools while qualifying real Provider, Store, projection, and Host adapters separately.
- Make authentication, authorization, local durability, remote durability, file projection, and consistency independently observable.

### Non-Goals

- A managed SaaS control plane, billing, organization administration, or multi-region operations.
- A general-purpose account system outside the reference Host's scoped credentials and invitation workflow.
- A second collaboration implementation in framework bindings or plugin-runtime.
- A public CRDT update API, raw Awareness wire, or third-party Provider object.
- E2EE, comments, mentions, or version history.

## Decisions

### Decision 1: One exclusive Core source owns authority, history, and external-document mode

Core adds one owner-scoped registration:

```ts
export type EditorTransactionAuthority = "proposal" | "authoritative";

export interface EditorHistoryController {
  undo(): boolean;
  redo(): boolean;
}

export interface EditorAuthoritativeSourceRegistration
  extends EditorContributionRegistration {
  dispatch(
    transaction: CoreEditorTransaction,
  ): CoreEditorTransactionDispatchResult;
  dispatchTransactions(
    transactions: readonly CoreEditorTransaction[],
  ): CoreEditorTransactionDispatchResult;
}

export interface EditorTransactionContributionSink {
  registerAuthoritativeSource(
    ownerId: string,
    history: EditorHistoryController,
  ): EditorAuthoritativeSourceRegistration;
}
```

The registration's `ready` promise resolves only after authoritative dispatch, history routing, and external-document behavior are active. A competing source fails atomically. Disposal is idempotent and restores ordinary behavior.

Core also exposes an owner-scoped `registerDestroyListener(ownerId, listener)` lifecycle seam on the contribution sink. Editor destruction invokes every registered listener exactly once before the transaction pipeline and view are torn down, isolates synchronous listener failures, and catches rejected listener promises so asynchronous cleanup cannot become an unhandled rejection. Registrations are idempotently disposable and new registration after destruction fails explicitly.

Only the active registration can create `authoritative` transaction/update contexts. Origin strings and CodeMirror annotations cannot escalate authority. Authoritative dispatch bypasses Local Proposal reject/replace filters but still updates EditorState, AST, events, and listeners in one synchronous commit.

While the source is active, its history controller receives `EditorAPI`, keyboard, browser `beforeinput`, and Host history commands. An empty external history never falls through to CodeMirror history. The controller boolean reports whether the external model changed, not whether projection history may run.

### Decision 2: Current table editing falls back to Markdown source under external authority

The source registration automatically activates an internal external-document mode. The current live-preview table cannot own a contentEditable text draft in this mode. Activating a cell reveals and focuses the corresponding Markdown source so every character enters EditorState as a Local Proposal.

Existing structural commands that already dispatch Core transactions remain available. Before an Authoritative Update, Core cancels active non-text table/widget pointer gestures, releases editing locks, and never commits partial DOM state. A future transactional Widget editor requires its own approved design.

### Decision 3: `CollaborationEngine` is the deep public module

```ts
export interface CollaborationEngineOptions {
  readonly providers: CollaborationProviderFactory;
  readonly store: ReplicaStore | { readonly mode: "volatile" };
  readonly localPresence?: LocalPresenceProvider;
  readonly diagnostics?: CollaborationDiagnosticSink;
}

export interface CollaborationEngine {
  create(
    document: CollabDocumentRef,
    options: { readonly initialMarkdown: string },
  ): Promise<CollaborativeDocumentHandle>;
  open(
    document: CollabDocumentRef,
    options?: {
      readonly readiness?: "allow-local-authority" | "require-authenticated-sync";
    },
  ): Promise<CollaborativeDocumentHandle>;
  getSnapshot(documentId: DocumentId): CollaborativeDocumentSnapshot | undefined;
  list(): readonly CollaborativeDocumentSnapshot[];
  subscribe(listener: CollaborationListener): Unsubscribe;
  close(): Promise<void>;
}

export interface CollaborativeDocumentHandle {
  readonly id: DocumentId;
  whenReady(): Promise<void>;
  getMarkdown(): string | undefined;
  getState(): CollaborativeDocumentSnapshot;
  subscribe(listener: CollaborationDocumentListener): Unsubscribe;
  reconcilePersistence(): Promise<void>;
  attach(
    editor: EditorAPI,
    options: { readonly content: "replace-editor" | "require-match" },
  ): Promise<EditorBindingHandle>;
  close(): Promise<void>;
}
```

Callers do not coordinate Y.Doc observers, source readiness, UndoManager, Provider start, Presence expiry, or Registry reference counts. Deleting the Engine would force that complexity into every Host, framework example, and test, so the Module earns its seam.

### Decision 4: Stable identity and explicit create/open prevent duplicate seeding

`DocumentId` is an opaque branded string whose default textual form is a UUID. It is independent of path and File Identity. The Host owns persistence of the association.

`create(ref, { initialMarkdown })` is the only operation allowed to seed `Y.Text("content")`. A durable create opens the Store only to obtain its checkpoint, starts the Provider against an empty Replica, and therefore never applies or uploads stale cached updates. After authenticated synchronization confirms that the remote room is still empty, it checkpoint-replaces the cache, writes the creation marker and initial Markdown, and flushes the Store before reporting readiness. Authentication failure or an existing remote document leaves the old cache unchanged. `open(ref)` never seeds from an empty Editor, empty Store, or file. Its default `allow-local-authority` readiness supports an already enrolled durable Replica during an outage. The Workspace uses `require-authenticated-sync` for invitation joins: Engine opens the Store only to obtain its checkpoint, starts the Provider against an empty Replica, validates authenticated remote schema, then atomically replaces and flushes the stale cache with one complete remote snapshot before returning a handle. Invalid authentication never appends to or replaces the cache.

Concurrent opens for one DocumentId share one Registry opening operation, Provider start, and Replica in a JavaScript realm, while returning independently closable handles. Authority provenance belongs to the Registry Replica and cannot be upgraded in place: only an entry initially created by `require-authenticated-sync` may serve a strict invitation open. A local-first or locally created entry rejects strict reuse with `remote-authority-unavailable`; releasing that failed call never closes a Replica held by an existing resume/create handle. File Projection, Enrollment, and Editor attachment all remain after this gate. Binding installation rejects Local Proposals with `collaboration-binding-not-ready` until its listener, Y.Text observer, authoritative source, and final current-Replica reconciliation are complete; a remote update inside that window is therefore projected rather than missed. `replace-editor` is explicit permission to replace an unused Editor projection; `require-match` fails without overwriting pre-existing divergent content.

Every Binding registers through Core's Editor-destroy lifecycle seam. Direct Editor destruction immediately marks the Binding detached and synchronously removes Presence, Y.Text observation, proposal/history ownership, and Replica bookkeeping before the Editor view disappears. Promise-returning disposer work continues behind the same cached detach promise; failures remain aggregated and are reported as `editor-destroy-cleanup-failed` without an unhandled rejection or a stale Binding quarantining the shared Replica.

The Electron Host persists a version-4 Enrollment state. It retains active Enrollments, pending creations, exact-identity deletion tombstones, and path-deletion reservations from version 3 and adds non-secret pending invitation joins bound to exact VaultId, sender, session, operationId, path, FileId, and DocumentId. Versions 1–3 remain readable and normalize to version 4 on a later mutation. Before the remote-effecting create starts it commits a pending creation intent. Begin/commit mutations are revision-checked and read back an ambiguous write before deciding that it failed. Rename, forget, and pending-creation abandon compare the complete expected record, not only FileId. Forget first moves that exact identity into a durable operation-id tombstone; Projection Base CAS failure can restore only that still-current tombstone, so rollback never overwrites a concurrently renamed identity. If the remote document opens before active Enrollment commits, the pending creation remains recoverable: the live process may reuse its retained session, while a restarted process requires the owner credential and resumes with File Projection enrollment semantics. Explicit pending-creation abandon removes only that local recovery intent after best-effort cleanup; it does not claim to delete a possibly created remote document.

### Decision 5: Yjs remains internal to the Engine implementation

The implementation fixes `yjs@13.6.32` and `y-protocols@1.0.7` and rejects Yjs 14 `@y/*` packages in the same dependency graph. Every Replica owns:

- `Y.Doc`;
- `Y.Text("content")`;
- `Y.Map("nexus:meta")` with `schemaVersion`, DocumentId check, and creation marker;
- Awareness;
- one Provider lease and Store lease;
- zero or more Editor Bindings.

The package does not expose Y.Doc, Y.Text, binary update helpers, Awareness, or provider-specific types through its ordinary caller interface.

### Decision 6: Nexus-native binding preserves proposal policy and CRDT authority

```text
Local Proposal
→ Nexus filters
→ committed Core update
→ Y.Text transaction(bindingLocalOrigin)

Y.Text change from another origin
→ convert delta to CoreEditorChange[]
→ authoritativeSource.dispatchTransactions()
→ EditorState / AST / events / listeners
```

The Y.Text observer ignores a Binding's own local origin when projecting back to that Editor. The Core listener ignores updates produced by its own authoritative source. Each Binding owns a unique local origin and a `Y.UndoManager` that tracks only that origin, so Undo does not remove other participants' work.

After every commit the Binding compares the Editor projection with current Y.Text. A mismatch quarantines that Binding and stops Local Proposals; it never rewrites the Y.Doc to match a divergent Editor.

### Decision 7: Provider and Store are real internal seams with honest assessment adapters

```ts
export interface CollaborationProviderFactory {
  prepare(context: ProviderContext): Promise<ProviderLease>;
}

export interface ProviderLease {
  start(): Promise<void>;
  getState(): ProviderState;
  subscribe(listener: ProviderStateListener): Unsubscribe;
  release(): Promise<void>;
}

export interface ReplicaStore {
  open(documentId: DocumentId): Promise<ReplicaStoreLease>;
}
```

`prepare()` does not connect or mutate the supplied Replica. Provider start happens only after the shared schema is addressable. Local-authority resume restores and observes the Store first; remote-first create and authenticated-sync open retain only its checkpoint and intentionally defer observation until remote validation decides whether the old cache must be preserved or replaced. Transport connection and initial sync are separate state dimensions. Release is idempotent and does not destroy Engine-owned Yjs objects.

Authentication failures are stable, distinct states: malformed, forged, or wrong-room credentials become `authentication="denied"`; an elapsed credential becomes `authentication="expired"`; and an actively revoked grant becomes `authentication="revoked"`. They map to `authentication-denied`, `authentication-expired`, and `authorization-revoked` diagnostics respectively, clear local Presence, set access to `none`, and require a fresh credential. The Host Workflow observes those states and suspends its Editor Bindings. An ordinary network disconnect remains a transport failure and does not invent an authentication verdict.

Credential refresh is serialized per DocumentId. The Electron connection adapter assigns every staged credential an in-memory generation and shares only a same-generation reconnect; a newer staged generation receives a stable in-progress rejection until the current reconnect settles and remains pending afterward. Failed reconnect rollback uses active-credential compare-and-set, so it restores the prior capability only when the attempted capability is still active. Workflow and Workspace add their own public-operation gates so overlapping callers cannot resume Editor Bindings twice or report that an unattempted credential succeeded. Different DocumentIds do not share a gate. Leave marks the Workflow session closed before waiting for an active refresh, and refresh rechecks that lifecycle after the Provider grant; Workspace leave/close also waits before releasing the session or backend, preventing a late grant from reviving an Editor Binding.

The trusted-host CLI issues a one-hour credential by default, while the Electron invitation adapter requests a five-minute delegated credential. These are separate lifetimes: the server still rejects any child credential whose expiry would exceed the delegating editor credential. The client recognizes only the server's exact, bounded JSON delegation error codes and turns an insufficient remaining lifetime into a safe reauthentication action without displaying a bearer token or response body. Acceptance additionally requires the envelope's canonical ServerUrl to equal the adapter's configured canonical ServerUrl; mismatch fails before either the in-memory credential or accepted-server state changes.

The reference server's file revocation store removes expired records after load and before every atomic persistence operation. A load that discovers stale records atomically rewrites the bounded JSON file, and a record that expires while the process is running is durably removed before the observing `has()` call completes. All mutations share the existing serialized write queue so cleanup cannot overwrite a concurrent revocation.

Runtime revocation and every authenticated inbound Hocuspocus message share one keyed operation gate. The common `beforeHandleMessage` boundary acquires a credential turn, rechecks durable authorization under it, and retains it through response/apply and `afterHandleMessage`. This includes non-mutating reader SyncStep1 and QueryAwareness paths, so a request admitted before revocation cannot encode or send authoritative document/Presence state after `revokeToken()` returns. A writable SyncStep2/Update additionally acquires its per-document turn in fixed credential-then-document order and, after the cooperative yield, rechecks authorization before candidate validation and Y.Doc mutation. `revokeToken()` acquires the same credential turn before persisting revocation and closing matching live connections. An admitted operation therefore either completes before revocation returns or observes the persisted revocation without reading, mutating, or sending protected state afterward. Failure releases turns in reverse order; unrelated credential/document keys remain independent.

The version-pinned Hocuspocus 4.6 `connected` seam installs an ingress budget on each authenticated document `Connection` before another socket frame can be dispatched to it. Raw `Uint8Array` identity ties admission to the matching `afterHandleMessage` completion; authentication rejection releases the same accounting in its earlier failure path, while frames drained before `connected` remain untracked. The pre-authentication queue independently uses the stricter authenticated count/byte budgets as its own bounds. During handoff the bootstrap queue may still be draining while the established gate admits one more bounded set, so the transient total is at most the sum of both budgets and never more than twice the authenticated budget. Overflow closes the responsible document connection and underlying socket with `authenticated-queue-limit`. Exact candidate sizing remains whole-document Yjs work, so the reference deployment defaults to an 8 MiB document ceiling, rejects configuration above the measured 16 MiB boundary, yields the event loop once under the per-room lock before each expensive check, and caps server-persistence generation waiters at 64 per document. Its other default request bounds are a 1 MiB WebSocket frame, 16 KiB per-client Awareness state with at most 64 states per message, a 4 KiB invitation body, and a 15-minute invitation-lifetime ceiling.

Deterministic in-memory Provider and Store adapters remain under the assessment export. A separate Hocuspocus adapter bridges the Nexus binary replica port to the authenticated WebSocket protocol; browser IndexedDB and Electron SQLite adapters satisfy the same Store seam. Vendor, Node, and Electron dependencies remain outside the ordinary browser entry.

### Decision 8: Presence is ephemeral and untrusted

Presence uses Awareness and Y.RelativePosition but remains outside durable document state. Local selection updates are throttled and coalesced. Remote display fields have type and length bounds; text renders as text, URLs and colors pass allowlists, and Presence identity never grants authorization.

Blur, document switch, detach, disconnect, and Engine close remove local cursor state. Stale remote states expire. Presence loss, duplication, or reordering cannot affect document convergence.

### Decision 9: Framework and native integrations remain thin

Vanilla attaches an EditorAPI directly. React uses the existing `onReady` callback, and Vue uses the corresponding ready/mounted path. Framework packages do not own Replica or collaboration state.

An optional `CollaborationLifecyclePlugin` may translate public `EditorHostService` attached/detached/contextChanged events into Engine attach/detach operations. It only attaches a DocumentRef already enrolled by the Host. Deleting this adapter does not alter Engine behavior tests.

The assessment lab remains a developer tool. The primary Electron flow uses Host-owned enrollment, the real Provider, durable Store, and File Projection across distinct renderer processes. Product UI orchestrates the Engine and adapters but does not own another Replica or synchronization state machine. `pnpm dev:electron-demo` selects this runtime Host when no compatibility override is present; `NEXUS_PLUGIN_PLATFORM=0` is the explicit legacy compatibility path, and any other configured value fails closed. A File-menu **New Collaboration Window** command creates another runtime BrowserWindow, so the multi-window product path is user reachable rather than confined to a test harness.

Main, preload, and utility-worker artifacts share one Electron tsup configuration. The sandboxed preload keeps collaboration-package imports type-only and performs the already-validated DocumentId branding at its local IPC seam, so neither a packaged application nor a clean development checkout depends on a workspace-package runtime build. The development launcher accepts only loopback HTTP renderer URLs without credentials, query, or fragment, waits for a successful Vite response within a bounded timeout, and spawns Electron only after that readiness gate succeeds. The main process independently revalidates `VITE_DEV_SERVER_URL`, so bypassing the launcher with an untrusted value fails before navigation. A real Electron startup smoke launches the built main process, sandboxed preload, utility worker, and secure `nexus-app://editor/` renderer in both default-runtime and explicit-legacy modes; it waits for an explicit completed-boot marker, checks product DOM and the mode-appropriate bridge surface, and performs a minimal Store round trip. This closes the built-artifact blank-startup gap only; it is not packaged multi-renderer workflow or renderer/utility crash qualification. The separate collaboration acceptance in Decision 15 covers the actual Linux product workflow.

The renderer entry dynamically imports the application module before calling `boot()`, so module-resolution and module-evaluation failures reach the same bounded failure path as asynchronous boot rejection. That path replaces partial UI and creates an `#app` fallback when the document has no root. After navigation completes, the main process gives the renderer 15 seconds to publish `data-nexus-startup-state="ready"` or `"failed"`; an absent or stuck state trips the watchdog instead of leaving a silent blank window.

Host-controlled startup failure surfaces reveal only stable codes and static recovery guidance: `renderer-url-invalid` for an untrusted development URL, `preload-load-failed` for the sandboxed preload, `renderer-load-failed` for navigation, `renderer-startup-timeout` for the 15-second watchdog, and `renderer-startup-failed` for module loading or renderer boot. Those handlers deliberately discard the raw rejection or Electron event payload rather than rendering or logging it, so a token, credential-bearing URL, private path, or Markdown content contained in the cause cannot cross into the Host dialog, renderer failure page, or Host-owned renderer diagnostic.

One Host-owned document-context transaction serializes collaboration create/join/resume/recovery with open-file, open-vault, Save, Save As, rename, and delete operations. The opening side re-reads and generation-checks the current path, Editor, and Markdown under the same transaction before any attachment. Save captures the exact path, Markdown, and generation it writes and clears dirty state only if they still match when the asynchronous write returns. This prevents a stale panel capture from enrolling the wrong document or a late Save from acknowledging newer Editor content.

### Decision 10: State is orthogonal and support is evidence-scoped

The public snapshot separates:

```ts
interface CollaborativeDocumentSnapshot {
  lifecycle: "opening" | "open" | "closing" | "closed" | "failed";
  transport: "idle" | "connecting" | "online" | "offline" | "failed";
  sync: "restoring" | "syncing" | "synced" | "stale" | "failed";
  authentication:
    | "not-required"
    | "authenticating"
    | "authenticated"
    | "denied"
    | "expired"
    | "failed"
    | "revoked";
  access: "none" | "local-only" | "read-only" | "read-write";
  persistence: "volatile" | "loading" | "clean" | "pending" | "failed";
  consistency: "healthy" | "catching-up" | "quarantined";
  peers: readonly PeerSnapshot[];
  diagnostic?: CollaborationDiagnostic;
}
```

Assessment and real-adapter evidence are recorded independently. A local reference deployment may be called functional only for the platforms and failure scenarios actually exercised; hosted-service SLO, external security review, multi-region recovery, and unsupported platforms remain outside that claim.

Durable Engine append work is bounded by `storeBackpressure.maxPendingOperations` and `storeBackpressure.maxPendingBytes` (defaults: 256 operations and 16 MiB). An append failure or overflow stops per-update enqueueing and marks persistence failed while a dirty generation tracks later live changes. Persistence reconciliation drains prior work and repeats full checkpoint-bound snapshot replacement until that generation is stable; `clean` is published only after the stable snapshot is flushed and no append remains pending.

### Decision 11: Hocuspocus is isolated behind a binary bridge

The real WebSocket adapter owns an internal proxy Y.Doc/Awareness pair because the Hocuspocus client requires those objects while the Nexus Provider seam intentionally exposes only binary state/update operations. Bidirectional origin guards and Yjs idempotency keep the proxy and Engine Replica synchronized. Authentication state and access mode cross the seam as Nexus values; Hocuspocus objects never enter the ordinary package interface.

### Decision 12: Browser and Electron durability use different adapters

Browser Hosts use native IndexedDB with one database namespace per Host and DocumentId-keyed journals. IndexedDB Store/lease shutdown rejects new operations as soon as closing starts but drains every already accepted lease operation before closing the connection, so a successful shutdown cannot cancel an acknowledged-in-progress append. Electron uses one utility process as the sole owner of a built-in `node:sqlite` connection; renderer adapters communicate through message ports and never receive SQL or filesystem paths. Its preload lease and Store close paths likewise stop new work and drain their already accepted per-lease tails before closing the lower Store. Because utility shutdown arrives on a different parent channel from renderer operations, broker close first sends a bounded drain request on every renderer MessagePort. The preload bridge synchronously stops accepting new operations, drains both its already accepted per-lease tails and the lower MessagePort client's pending requests, and only then acknowledges; FIFO places every earlier renderer request before that acknowledgement in the broker queue. Lease cleanup and SQLite close start only after those barriers. Missing drain acknowledgement fails cleanup after a bounded timeout, and the supervisor accepts only the explicit worker cleanup acknowledgement—not an unacknowledged zero exit—as proof of durability. Built-in SQLite is capability-gated to Node >=22.5/Electron runtimes that expose `node:sqlite`, avoiding a native addon and rebuild pipeline.

The Electron composition scopes its shared local Replica Store by the tuple `(canonical ServerUrl, DocumentId)`. It hashes a versioned domain plus that tuple to an opaque bounded Store key, so two servers may safely use the same remote DocumentId without sharing a local journal. Legacy rows keyed only by a bare DocumentId have no trustworthy server origin and are deliberately quarantined rather than auto-attached to an arbitrary server.

An append failure may mean “not committed” or “committed but the reply was lost.” `reconcilePersistence()` therefore waits for the current Store queue, reloads durable updates, applies them idempotently, replaces through the Store-owned checkpoint with a complete live Replica snapshot, flushes, and only then clears `persistence="failed"`. A failed reconciliation remains failed and can be retried from the Workflow/UI.

### Decision 13: File Projection is a separate deep module

`FileProjectionCoordinator` consumes a small collaborative Markdown port plus a Host file adapter and identity store. It owns Projection Base, atomic export, watcher echo classification, three-way reconciliation, conflict generations, and resolution. The Engine only exposes document Markdown observation and one intentional document-replacement operation; it does not learn paths or filesystem semantics.

The Electron file lifecycle atomically reserves the target path before delete after the document-change gate has succeeded; a directory reservation covers every descendant. The renderer first installs a main-process `precommit` fence with a pre-generated operationId, then writes the durable Enrollment reservation with that exact identity, and finally promotes the Host fence to `committed`. Both states block same-Vault mutations and survive renderer/session close. Host-only precommits are enumerable for explicit recovery, while another product instance promotes a precommit when durable read-back proves the reservation committed; therefore crashes on either side of the durable CAS never reopen the path. The stable-VaultId barrier waits for already admitted projection writes, then fences overlapping ordinary writes, folder creation, rename, and new projection permits across every renderer/session; only trash carrying the exact reservation operationId may cross it. Product initialization re-installs durable reservations after Host restart. Begin-create, commit, upsert, and rename also reject reserved paths, closing both the list-before-trash race and the process-restart gap. Existing pending creation intents prevent reservation. The reservation spans trash and post-delete coordination, which forgets every exact descendant Enrollment and Projection Base, and is released after trash failure or successful coordination (UI refresh may fail independently). A coordination failure after successful trash retains both layers for explicit same-Vault recovery. Rename updates active Enrollment or pending intent together with the projection path. If post-filesystem collaboration coordination fails, the Vault attempts a compensating filesystem rename and then compensates collaboration metadata; incomplete compensation is surfaced as an aggregate failure rather than hidden.

`subscribeMarkdown()` immediately replays the current snapshot. File Projection captures that same live revision and Markdown as its observed baseline before subscribing, so the initial replay confirms observation instead of becoming a false edit and extra metadata CAS.

Every Electron File Projection write acquires a bounded main-process permit before re-reading its durable Projection Base and exact Enrollment, pending-creation identity, or exact committed pending-join operation. This order makes an in-flight write part of the same-Vault mutation barrier while ensuring a restarted main process cannot manufacture authority: an active durable delete reservation, identity tombstone, missing authority, or FileId/path/DocumentId mismatch fails before disk I/O. Invitation join first installs a main-process `precommit` scoped to exact VaultId, sender, session, path, DocumentId, and operationId; persists the matching version-4 pending join including FileId; and promotes the Host fence to `committed` before any Projection metadata or file write. It excludes competing joins, ordinary Host writes, and deletes from authentication through projection and Enrollment CAS; only the exact committed operation may acquire projection permits. Expiry or renderer/session failure revokes the current holder but retains an enumerable inactive blocking fence and its immutable original owner. Another renderer may rebind only with the exact durable owner; after Host restart the durable pending join recreates the fence. Enrollment and pending phase `enrollment-committed` commit in one CAS. Exact Host release must succeed before the pending join is cleared and the Workspace becomes active; release is retried once and persistent failure remains actionable and recoverable. Permit timeout releases an abandoned lane but waits for an already admitted filesystem call to settle.

Pending-join recovery is evidence-based. An exact committed Enrollment completes Host release. Exact Projection metadata may commit that same Enrollment without touching the Markdown file; this includes `base:null`, because `writeAtomic` can succeed before Projection Base confirmation. Missing metadata does not prove that the file was never written, so the Host retains the pending join and fence fail-closed; the user can retry the same invitation or explicitly abandon only local coordination after a warning. Any Projection metadata—matching or conflicting—prohibits pending-join abandon; the Host must first recover the exact Enrollment and then use ordinary exact forget. If explicit abandon or pre-projection rollback releases the Host fence but durable pending removal fails, the coordinator reconstructs and commits that exact fence before surfacing failure; an ambiguous removal is accepted only when read-back proves the intent absent. Conversely, failure to clear an `enrollment-committed` pending join after Host release remains safe because the same atomic CAS already installed the active Enrollment and the retained pending record blocks competing join, rename, forget, and delete; recovery may rebind only to finish cleanup. A locally owned active fence enters this evidence check directly, while a different active renderer remains untouched. Rename and delete reject paths covered by a pending join.

Conflict resolution generation-checks both the live Collaborative Document revision and incoming file version. Projection metadata uses cross-window revision CAS and revalidates FileId, DocumentId, and path after contention so a stale window cannot roll back another window's rename. The initial watcher is established in a preparing state before the first read; it buffers changes and renames until initial reconciliation commits, then drains them in arrival order so an old-path read cannot be confirmed against a new path. That initial read/reconcile is also the head of the normal projection queue: a Collaborative Document update observed during the read is processed afterward against the Projection Base established from the initially observed document revision, never as a concurrent read/write lane. The Host fails closed on malformed envelopes, non-canonical identity, or a Projection Base hash mismatch, and rejects a new identity at its bounded metadata capacity. Directory rename/delete events update descendant watched paths in serialized order; attach/move versus close races do not leave replacement watchers behind.

Forget and explicit pending-creation abandon load and validate the exact Projection Base identity and revision before CAS deletion. If metadata cleanup fails after the identity mutation, the Workspace restores only its exact durable tombstone and surfaces the cleanup failure; a stale rollback cannot recreate an older path. Pending-join abandon never deletes Projection metadata or modifies Markdown and is rejected whenever any metadata exists. Tombstones and delete reservations are enumerated as recovery-required and are never auto-recovered by another renderer. Pending joins are also visible in the panel, which reports the recovery outcome and offers safe recovery, same-invitation retry, or abandon only when the evidence permits it. A Workspace rejects forget while it is active, opening, or closing.

### Decision 14: One Host Workspace owns the product workflow

`CollaborationWorkspace` composes versioned Enrollment, Engine handles, Provider credentials, Store selection, Editor Binding, and File Projection. Its interface expresses create, join, pending-create recovery/abandon, crash-recoverable pending-join transactions, connection and persistence retry, leave, resolve conflict, inspect, subscribe, and close. It derives UI state from underlying snapshots and never recreates their state machines.

Detach, document/session/workflow close, pending-recovery cleanup, and Host product teardown are idempotent best-effort operations. They attempt every owned release even after an earlier one fails and report multiple failures as `AggregateError`; one cleanup failure must not strand resources that occur later in the ownership order.

### Decision 15: Trusted desktop networking and real-window acceptance

The Host reads a bounded `NEXUS_COLLAB_SERVERS` allowlist before window creation. The default is the local reference server; non-loopback endpoints require WSS. This configuration drives one canonical URL policy, the window's enforced CSP, renderer backend admission, and the invitation broker. A built application uses a secure standard `nexus-app://editor/` origin with static-file confinement; the development renderer retains its validated loopback URL and receives the same CSP through its session. CSP is installed before application scripts, never weakened by wildcard schemes or disabled web security.

Invitation issuance crosses a small `nexusCollabNetwork` command seam. The registered top-level runtime window submits an exact server, editor capability, document, invitee, role, and lifetime; main performs a bounded, redirect-free HTTP(S) POST to the fixed invitation route and validates the returned identity and expiry. This avoids trusting `Origin: null` on a network-exposed server. Sender teardown cancels outstanding operations. Credentials remain memory-only; this is not a general-purpose fetch or signing API.

Acceptance drives the actual application DOM in independent BrowserWindows through creation, invitation, join, editing, history, authorization, offline/restart and file-conflict recovery. TLS is tested using an isolated trusted test certificate without disabling certificate verification. A local TLS proxy does not qualify public DNS, a remote machine, service operations or other supported platforms. The user's previous PR is closed and its remote branch deleted. After local acceptance, the user authorized the single final PR from `feat/collab-product-completion`; historical qualification records retain the pre-submission branch and worktree state.

## Risks / Trade-offs

- **The single PR is larger than normal.** Keep one concern, order commits by dependency, isolate modules, and provide a per-package PR summary.
- **Proposal and implementation cannot receive separate reviews.** Record the assessment exception and make the final diff independently reviewable; do not rewrite repository governance.
- **A reference deployment can be mistaken for an operated SaaS.** Publish exact topology, security assumptions, backup boundary, platform matrix, and missing SLO evidence.
- **A pending creation can outlive its credential.** Persist only its non-secret identity before the remote effect; require a fresh owner capability after restart and make local abandon explicit without claiming remote deletion.
- **Legacy local Replica keys lack server provenance.** Quarantine bare-DocumentId rows; an explicit Host migration with known origin is safer than guessing and crossing server tenants.
- **Table UX is less direct under collaboration.** Source fallback protects document integrity; transactional table editing is deferred rather than faked.
- **IME and selection mapping are browser-sensitive.** Add focused regression tests and limit the support statement to exercised Chromium/Electron environments.
- **A large interface would fossilize guesses.** Keep the caller interface small; Provider, Store, Registry, Binding, and Presence seams remain package-internal unless Host substitution actually requires them.

## Migration Plan

Existing Editors do not register an authoritative source and behave unchanged. Collaboration remains opt-in. Existing assessment imports remain available, while real adapters use explicit subpath entries and the product Host migrates from the lab to a Workspace-owned flow. The Electron demo now starts that runtime Host by default; callers that still need the old Host must opt into it with `NEXUS_PLUGIN_PLATFORM=0`. Version-1 through version-3 Enrollment states are read and normalized into the version-4 envelope on a later mutation; ambiguous legacy Replica rows keyed by bare DocumentId stay quarantined because their ServerUrl cannot be reconstructed safely.

The user has now authorized submission of the locally validated candidate as one final PR, without a version release or automatic merge. The OpenSpec change stays active; maintainers archive it only after a later merge under their normal process.

## Open Questions

External deployment ownership, public DNS/TLS termination, backup retention, multi-region topology, and production SLOs remain Host/operator decisions. They do not block a complete self-hosted reference slice, but no test in this repository can silently choose or qualify them.
