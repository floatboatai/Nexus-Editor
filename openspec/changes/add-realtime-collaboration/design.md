## Context

Realtime collaboration is not just a UI feature. It changes how document changes are represented, merged, attributed, persisted, and replayed. The editor core is intentionally single-document and host-agnostic, so the collaboration layer should be a plugin that composes with CodeMirror state rather than a core rewrite.

## Goals / Non-Goals

**Goals:**
- Multiple clients editing the same logical document converge without manual merge conflicts.
- Local edits remain responsive while remote edits arrive asynchronously.
- Remote cursor and selection presence can be rendered without taking editor focus.
- Hosts own transport, identity, authentication, authorization, and persistence.
- The first implementation can be tested without a production server.

**Non-Goals:**
- Comments, @mentions, annotation threads, or review workflows. Those are Roadmap #20.
- Cloud storage or vault sync. That is Roadmap #23.
- Version history snapshots. That is Roadmap #19.
- Permission models, ACLs, or end-to-end encryption.
- A hosted collaboration server maintained by this package.

## Decision 1: Use CRDT, not Operational Transform

Use a CRDT document model for shared editing. Operational Transform can work well with a central authority, but it requires a stricter server contract and transformation logic across every operation shape. A CRDT model is a better fit for Nexus because the editor is local-first, host-embedded, and likely to support intermittent connections.

Proposed implementation target: Yjs.

Rationale:
- Handles concurrent edits and reconnect replay without a custom OT server.
- Has a mature ecosystem for awareness/presence and editor bindings.
- Keeps the Nexus plugin focused on integration and API design instead of inventing merge algorithms.

## Decision 2: Keep transport host-owned

The package should not open sockets itself by default. Instead, it should accept a provider object supplied by the host:

```ts
export interface CollabProvider {
  connect(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  destroy(): void;
  readonly status: "disconnected" | "connecting" | "connected" | "error";
  onStatusChange(listener: (status: CollabProvider["status"]) => void): () => void;
}
```

The concrete provider may wrap y-websocket, WebRTC, a custom backend, or an in-memory test transport. This keeps auth, tenancy, backend URLs, and persistence out of the editor package.

## Decision 3: New package, not core API

Create `@floatboat/nexus-plugin-collab`. Do not add collaboration concepts to `@floatboat/nexus-core` unless implementation proves that a small core hook is unavoidable.

The core already lets plugins add CodeMirror extensions. Collaboration should be one such extension. Core remains usable for single-user local editors and does not acquire network or CRDT dependencies.

## Decision 4: Awareness is optional and separated from document sync

Document sync and user presence should be configured separately. Some hosts may want conflict-free shared editing but no visible remote cursors. Others may want presence metadata only after auth resolves user names and colors.

Public options should look roughly like:

```ts
createCollabPlugin({
  docId,
  provider,
  awareness
});
```

`awareness` should expose local user metadata and remote peer changes. Rendering can start with selection decorations and cursor labels.

## Decision 5: Define lifecycle and document-loading rules early

Collaboration conflicts with naive `editor.setDocument()` usage. The plugin must define:
- initial document seeding: only seed an empty shared doc once
- remote update application: must not emit host `onChange` loops as local user saves
- teardown: unsubscribe provider and awareness listeners on editor destroy
- switching documents: destroy the old collaboration session before joining another `docId`

## Risks / Trade-offs

- CRDT dependency size: Yjs adds bundle weight. Keep the package opt-in and avoid pulling it into core.
- Binding maturity: if the preferred CodeMirror binding is stale, we may need a small internal adapter.
- Persistence ambiguity: hosts need clear docs that provider persistence is their responsibility.
- Undo/redo semantics: collaborative undo differs from local history. The first implementation should document expected behavior and test that local history does not corrupt remote edits.
- Live preview/table widgets: remote edits may arrive while widgets are active. Implementation must test editor stability but should not special-case every widget in v1.

## Open Questions

- Should the package export helper factories for common providers, or only types plus `createCollabPlugin`?
- Should collaboration mode disable local `setDocument()` after connect, or allow it as an explicit document reset API?
- Should awareness rendering be built in or exposed as data for host-rendered cursors?
- Should the demo use a tiny local websocket server, BroadcastChannel, or pure in-memory paired editors for the first smoke test?
