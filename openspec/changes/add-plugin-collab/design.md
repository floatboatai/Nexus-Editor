## Context

Nexus currently treats every public transaction as a policy-controlled local proposal. `CoreEditorTransactionPipeline.commit()` runs registered filters before updating the Editor, `EditorAPI.undo()` and `redo()` are wired to CodeMirror history, and the live-preview table can retain contentEditable cell text outside EditorState until blur. Those properties are valid for a standalone Editor but can make an Editor diverge from a CRDT that has already committed a remote update.

The collaboration module must remain usable without React, Vue, Electron, plugin-runtime, a filesystem, or a specific server SDK. At the same time, the take-home permits one final PR rather than the normal sequence of proposal and implementation PRs. The implementation therefore needs one deep Engine interface and one Core authority seam that remain valid when production Provider, Store, and file adapters are qualified later.

## Goals / Non-Goals

### Goals

- Deliver one runnable, reviewable `experimental` collaboration capability in one PR.
- Keep Core unaware of Yjs, network, persistence, files, accounts, and frameworks.
- Give one owner an exclusive authoritative dispatch and history path for one Editor.
- Preserve existing Local Proposal filter behavior for every other caller.
- Expose one headless Engine interface to direct Core, React, Vue, and native lifecycle callers.
- Prove deterministic Yjs convergence, multi-Editor binding, local-only Undo, Presence, and cleanup.
- Make missing production durability and Provider evidence explicit rather than hiding it behind `connected` or `synced`.

### Non-Goals

- Production Provider deployment, server durability, SQLite/IndexedDB adapters, or file reconciliation.
- Product accounts, invitations, permissions UI, conflict UI, or general-purpose UI.
- A second collaboration implementation in framework bindings or plugin-runtime.
- A public CRDT update API, raw Awareness wire, or third-party Provider object.
- Production support status.

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
  open(document: CollabDocumentRef): Promise<CollaborativeDocumentHandle>;
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

`create(ref, { initialMarkdown })` is the only operation allowed to seed `Y.Text("content")`. It writes a creation marker before reporting readiness. `open(ref)` always means join and never seeds from an empty Editor, empty Store, or file.

Concurrent opens for one DocumentId share one Registry opening operation and one Replica in a JavaScript realm, while returning independently closable handles. A first join without a valid local Replica waits for Provider initial sync before attachment. `replace-editor` is explicit permission to replace an unused Editor projection; `require-match` fails without overwriting.

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

`prepare()` does not connect or mutate the supplied Replica. Provider start happens only after schema validation and Store observation are ready. Transport connection and initial sync are separate state dimensions. Release is idempotent and does not destroy Engine-owned Yjs objects.

The PR includes deterministic in-memory Provider and Store adapters for contracts and the demo. `store: { mode: "volatile" }` is an explicit caller choice. Neither adapter is named or documented as production-ready. This leaves a stable seam for later Hocuspocus/Y-Sweet and IndexedDB/SQLite adapters without importing those dependencies now.

### Decision 8: Presence is ephemeral and untrusted

Presence uses Awareness and Y.RelativePosition but remains outside durable document state. Local selection updates are throttled and coalesced. Remote display fields have type and length bounds; text renders as text, URLs and colors pass allowlists, and Presence identity never grants authorization.

Blur, document switch, detach, disconnect, and Engine close remove local cursor state. Stale remote states expire. Presence loss, duplication, or reordering cannot affect document convergence.

### Decision 9: Framework and native integrations remain thin

Vanilla attaches an EditorAPI directly. React uses the existing `onReady` callback, and Vue uses the corresponding ready/mounted path. Framework packages do not own Replica or collaboration state.

An optional `CollaborationLifecyclePlugin` may translate public `EditorHostService` attached/detached/contextChanged events into Engine attach/detach operations. It only attaches a DocumentRef already enrolled by the Host. Deleting this adapter does not alter Engine behavior tests.

The Electron demo may use the deterministic assessment Provider to demonstrate two live Editors/windows. Visible copy must label it local/experimental and must not imply cloud durability, access control, or production support.

### Decision 10: State is orthogonal and support remains experimental

The public snapshot separates:

```ts
interface CollaborativeDocumentSnapshot {
  lifecycle: "opening" | "open" | "closing" | "closed" | "failed";
  transport: "idle" | "connecting" | "online" | "offline" | "failed";
  sync: "restoring" | "syncing" | "synced" | "stale" | "failed";
  persistence: "volatile" | "loading" | "clean" | "pending" | "failed";
  consistency: "healthy" | "catching-up" | "quarantined";
  peers: readonly PeerSnapshot[];
  diagnostic?: CollaborationDiagnostic;
}
```

The assessment can prove contract behavior and receive `experimental` status. It cannot prove production durability, authorization, file projection, platform coverage, or long-running service behavior, so it cannot receive `production-supported` status.

## Risks / Trade-offs

- **The single PR is larger than normal.** Keep one concern, order commits by dependency, isolate modules, and provide a per-package PR summary.
- **Proposal and implementation cannot receive separate reviews.** Record the assessment exception and make the final diff independently reviewable; do not rewrite repository governance.
- **The demo adapter can be mistaken for a backend.** Name it as an assessment/test adapter, keep it out of the default production entry, and state limitations in UI and README.
- **Table UX is less direct under collaboration.** Source fallback protects document integrity; transactional table editing is deferred rather than faked.
- **IME and selection mapping are browser-sensitive.** Add focused regression tests and limit the support statement to exercised Chromium/Electron environments.
- **A large interface would fossilize guesses.** Keep the caller interface small; Provider, Store, Registry, Binding, and Presence seams remain package-internal unless Host substitution actually requires them.

## Migration Plan

Existing Editors do not register an authoritative source and behave unchanged. Collaboration is opt-in. The new package starts at `experimental`, uses explicit create/open, and requires callers to opt into volatile storage when no Store is supplied.

The OpenSpec change remains active in the submitted PR. Maintainers archive it after merge under their normal process. Later production adapter and file-reconciliation work extends the existing Engine seams under new approved changes; it does not replace this interface.

## Open Questions

None block the assessment implementation. Production Provider deployment, durable Store, file projection, E2EE, data retention, and production SLO decisions remain explicitly outside this PR and cannot be inferred from a passing demo.
