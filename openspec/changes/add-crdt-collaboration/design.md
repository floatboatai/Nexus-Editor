## Context

Nexus stores Markdown in CodeMirror. Yjs owns the replicated character sequence;
CodeMirror is a local projection. Providers and persistence belong to the host.
The integration must preserve this boundary even while disconnected.

## Decisions

1. Expose `createCollaborativeEditor()` with the normal editor configuration,
   excluding `initialValue`. Initialize from the supplied attached `Y.Text`.
   Never seed an empty replica automatically: two offline clients independently
   inserting the same initial text would duplicate it after synchronization.
2. Translate accepted CodeMirror change sets into one Yjs transaction. Use a
   unique binding object as origin so each editor owns its undo history, even
   when two editors share a Y.Doc. Remote CRDT deltas become CodeMirror changes.
3. Remote transactions bypass local transaction filters but still notify update
   listeners. Rejecting a replicated operation would diverge the local projection.
   Authorization must happen at the provider boundary before applying Yjs updates.
4. Route the public undo/redo API through an optional generic CodeMirror history
   facet. The core has no Yjs dependency. Collaborative history cannot be combined
   with CodeMirror's positional history. Undo records relative selections so
   remote insertions do not invalidate cursor restoration.
5. Awareness uses Yjs relative positions and the conventional cursor/user fields.
   User names are text, never HTML. Ignore malformed or unrelated remote cursors.
   Destroy only binding-owned resources, not the host's document or awareness.
6. Collaborative tables use source editing. Existing table widgets defer cell
   edits until blur and retain stale row offsets during interaction; enabling
   them would risk overwriting remote edits. Other live preview remains enabled.

## Alternatives

- Whole-document synchronization cannot preserve concurrent changes.
- A bundled WebSocket service would impose infrastructure on a headless engine.
- OT requires a central authority and a different offline protocol.
- A custom CRDT is unnecessary; Yjs supplies convergence, state vectors and undo.

## Scope and trade-offs

This release supports plain-text Y.Text values. Rich-text attributes, embedded
objects, shared comments, and collaborative cell widgets are outside scope.
The host seeds a document once, exchanges binary Yjs updates, and authenticates
peers. It must not use framework controlled-value feedback to mirror each edit.
Local `setDocument()` remains an explicit shared replacement, not a room switch.

## Verification

Use real Y.Doc replicas with a deterministic in-memory network: simultaneous
insert/delete, partitions, duplicate delivery, reordered delivery, state-vector
reconnection, Unicode, selective undo, multiple editors, awareness, filters and
mount/destroy cycles. Run the repository's type, API, unit and build checks.
