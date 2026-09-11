# Design — Provider-Neutral, Yjs-First Realtime Collaboration

## Context

Nexus is a Markdown-source editor whose live AST and preview are derived from CodeMirror state. Collaboration must preserve that architecture: Markdown remains the only durable document representation, remote updates enter the normal editor transaction path, and Lezer/mdast/live-preview continue to derive from the resulting text.

"Provider-neutral, Yjs-first" means the CRDT is intentionally Yjs, while transport and persistence are not selected by this package. A host may attach any provider that synchronizes the supplied `Y.Doc`.

## Goals / Non-Goals

### Goals

- Eventual byte-for-byte Markdown convergence across peers.
- Incremental local-to-Yjs and Yjs-to-editor synchronization.
- No update echo, duplicate application, or full-document replacement during steady state.
- Local-only collaborative undo/redo.
- Optional presence and remote selection rendering.
- Safe lifecycle behavior across plugin disposal, editor destruction, IME composition, and table/widget interactions.
- Deterministic tests that can inject delay, reordering, duplication, disconnection, and reconnection.

### Non-Goals

- Owning provider connection/authentication/persistence.
- Generalizing the public API to arbitrary CRDT engines before a second engine exists.
- Sharing AST or visual widget state.
- Comments, mentions, snapshots, or tracked changes.

## Decisions

### Decision 1: Accept shared Yjs objects; do not wrap a hosted provider

The primary factory accepts a `Y.Doc`, a configurable shared-text field name, and optional awareness. Provider packages attach to the same document outside Nexus. No production dependency on `y-websocket`, Hocuspocus, or a proprietary service is allowed.

This keeps network credentials out of the editor plugin, permits offline-only and Electron IPC transports, and makes provider replacement independent from editor integration.

### Decision 2: Synchronize one `Y.Text` containing canonical Markdown

The Yjs shared type contains the Markdown source verbatim. Local CodeMirror changes are applied to `Y.Text` in descending source-position order inside one Yjs transaction. Remote Yjs deltas are translated to one atomic Nexus/CodeMirror transaction.

The plugin MUST NOT synchronize mdast, HTML, decoration state, table DOM, or rendered widgets. Those remain deterministic projections of the Markdown document.

### Decision 3: Shared content is authoritative at binding time

Binding initialization reads the current `Y.Text` and initializes the editor from it before steady-state observation begins. The package exposes a helper that seeds an empty shared type, but it never automatically inserts every editor's `initialValue`; doing so allows two joining clients to duplicate initial content.

Hosts that need initial content seed the collaboration document once, preferably on the authority/persistence side, before mounting collaborative editors.

### Decision 4: Distinguish local, remote, initialization, and undo origins

Each binding owns a unique local Yjs transaction origin. Only that origin is tracked by its `Y.UndoManager`. Remote deltas enter Nexus with a stable `collab:remote` origin and `addToHistory: false`. Initialization uses `collab:initialize` and is also excluded from local history.

Observer guards and origin tagging both participate in echo suppression; correctness MUST NOT rely on a single mutable boolean that can be invalidated by nested or asynchronous work.

### Decision 5: Collaborative undo replaces ordinary history while active

The plugin exposes collaboration-aware undo and redo commands backed by `Y.UndoManager`. Undo tracks only the local binding origin, so a user's undo does not remove another user's edits.

The Electron demo and documentation will not install competing default history key bindings for a collaborative editor. Coexistence with `plugin-history` without duplicate key bindings is a later integration task unless it can be proven safe in this change.

### Decision 6: Awareness is optional and ephemeral

Content synchronization works without awareness. When awareness is supplied, the plugin publishes a namespaced local user/selection payload and renders remote selections and carets.

Selection anchors and heads are encoded as Yjs relative positions rather than absolute numeric offsets. Stale, deleted, malformed, or foreign-document awareness states are ignored without affecting document synchronization.

The plugin does not persist awareness and clears its local awareness contribution on disposal without deleting other clients' states.

### Decision 7: Composition and interactive widgets are explicit safety boundaries

Remote updates arriving during IME composition or an active Nexus interaction MUST not destroy/recreate the `EditorView`, duplicate composed text, or clear table selection/drag state. The implementation will use incremental transactions and existing interaction-safe reconfiguration paths. If an upstream primitive cannot safely apply a remote change mid-composition, the binding queues that change until the composition-safe commit point while retaining Yjs order.

### Decision 8: Provider neutrality is demonstrated by shared contract tests

The testkit defines a deterministic in-memory Yjs update bus and a provider-shaped adapter. The same lifecycle and synchronization contract runs against both. A WebSocket-backed smoke adapter may be a dev-only test dependency, but no concrete provider becomes part of the production API.

## Public API Direction

Names remain subject to proposal review, but the intended surface is:

```ts
export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
}

export interface CollaborationOptions {
  doc: Y.Doc;
  field?: string;
  awareness?: Awareness;
  user?: CollaborationUser;
}

export function createCollaborationPlugin(options: CollaborationOptions): NexusPlugin;
export function seedCollaborationDocument(doc: Y.Doc, markdown: string, field?: string): boolean;
export const collaborationUndo: Command;
export const collaborationRedo: Command;
```

The package MUST avoid exposing a `WebsocketProvider`, URL, token, room identifier, or hosted-service type.

## Validation Strategy

### Deterministic unit and integration tests

- Two real `createEditor()` instances in jsdom, each bound to its own `Y.Doc`.
- A controllable update bus that delays, reorders, duplicates, disconnects, and reconnects messages.
- Assertions on editor Markdown, `Y.Text`, AST, transaction origins, undo stacks, listener counts, and disposal.

### Property/convergence tests

Generate reproducible random sequences of inserts, deletes, selections, connection transitions, and message delivery orders. After delivering all updates, every peer's Markdown and encoded Yjs state MUST match. A failing seed is printed and promoted to a fixed regression test.

### Browser/Electron tests

Use two real Electron windows editing the same document. Exercise remote caret display, Chinese IME, offline edits, reconnect, local-only undo, and table interactions. The final saved Markdown from both windows MUST be byte-identical.

### Performance gates

- Remote single-edit updates MUST not call full-document `setDocument()`.
- A 10,000-line document with ten simulated peers and sustained edits must remain responsive and converge.
- A 30-minute soak must not show monotonically growing subscriptions, timers, awareness entries, or detached editor DOM.

## Risks / Trade-offs

- **Undo conflicts with existing history** → collaboration owns history while active and tests local-only undo explicitly.
- **Initial document duplication/data loss** → shared state is authoritative and seeding is explicit.
- **IME disruption** → real Chromium/Electron composition tests are release-blocking.
- **Table/widget DOM instability** → remote updates use the normal incremental transaction pipeline and all table interaction paths are regression-tested.
- **Provider-neutral claim becomes cosmetic** → production code imports no provider package and contract tests run through more than one provider-shaped implementation.
- **Large remote batches block input** → apply one atomic incremental transaction per Yjs transaction and benchmark realistic large documents.

## Migration and Rollback

The package is new and opt-in. Removing it from an editor's plugin list restores existing single-user behavior. Shared Markdown remains readable from `Y.Text`, so a host can export it and fall back to ordinary `initialValue` without format conversion.

## Open Questions for Approval

- Should the first release include remote caret labels, or only presence plus selection colors?
- Should collaborative undo key bindings be enabled by default when the plugin is installed, or exposed as commands for the host to bind?
- Is a real WebSocket provider smoke test required in CI, or is the deterministic transport plus manual Electron test sufficient for the first release?

