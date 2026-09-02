# `@floatboat/nexus-plugin-collab`

Experimental, browser-safe realtime collaboration for Nexus Editor. The package keeps a Yjs replica authoritative while each Nexus Editor remains a live projection of that replica.

## Support status

`experimental`. The package currently proves the engine, editor binding, scoped undo/redo, Presence, deterministic in-memory Provider, replayable in-memory Store, offline/reconnect simulation, and Electron two-editor demonstration.

It does **not** provide a production network service, authentication, authorization, encrypted transport, durable crash recovery, file reconciliation, or a production support claim. The assessment adapters live only under `@floatboat/nexus-plugin-collab/assessment` and must not be used as a production backend.

## Why the Engine is the public seam

`CollaborationEngine` owns the ordering and cleanup of replicas, Providers, Stores, editor bindings, history, and Presence. A caller never receives `Y.Doc`, `Y.Text`, `Awareness`, or a vendor-specific Provider object.

The important authority flow is:

```text
accepted Nexus Local Proposal -> Y.Text transaction(binding origin)
Y.Text change from another origin -> Core Authoritative Update -> Editor projection
```

This keeps existing transaction filters in front of local edits while preventing an already-committed CRDT update from being rejected or rewritten during projection.

## Direct Core usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  asDocumentId,
  createCollaborationEngine,
} from "@floatboat/nexus-plugin-collab";
import { createAssessmentProviderHub } from "@floatboat/nexus-plugin-collab/assessment";

const hub = createAssessmentProviderHub();
const engine = createCollaborationEngine({
  providers: hub.factory,
  store: { mode: "volatile" }, // explicit: process exit may lose data
});

const document = await engine.create(
  {
    id: asDocumentId("host-owned-stable-id"),
    hostIdentity: "vault-id",
    sourcePath: "notes/example.md", // metadata, never the room identity
  },
  { initialMarkdown: "# Shared note" },
);

const editor = createEditor({ container, initialValue: "# Shared note" });
const binding = await document.attach(editor, { content: "require-match" });

// Teardown order is idempotent.
await binding.detach();
editor.destroy();
await document.close();
await engine.close();
await hub.close();
```

`create()` is the only seeding operation. `open()` is join-only and fails after initial synchronization if the document has no valid creation marker. Concurrent `open()` calls share one replica but return independently closable handles.

Use `content: "require-match"` when the Editor must already represent the collaborative content. Use `content: "replace-editor"` only when the Host explicitly permits the replica to replace the Editor projection.

## React and Vue integration

Framework wrappers do not own collaboration state. Attach the same document handle through the existing editor-ready lifecycle and detach during unmount:

```tsx
useEffect(() => {
  if (!editor) return;
  let binding: EditorBindingHandle | undefined;
  void document.attach(editor, { content: "replace-editor" })
    .then((next) => { binding = next; });
  return () => { void binding?.detach(); };
}, [document, editor]);
```

```ts
onMounted(async () => {
  binding = await document.attach(editorRef.value!, { content: "replace-editor" });
});
onBeforeUnmount(() => binding?.detach());
```

For plugin-runtime Hosts, subscribe to public `EditorHostService` attached, detached, and context-changed events, resolve a Host-enrolled `CollabDocumentRef`, and call the same `document.attach()` path. This package intentionally does not guess enrollment or derive `DocumentId` from a file path.

## Provider contract

A Provider factory receives a browser-safe binary replica port. `prepare()` must not connect or mutate the replica. `start()` runs only after Store restore and schema validation are ready. Provider state separates transport (`connecting`, `online`, `offline`) from initial synchronization (`syncing`, `synced`, `stale`). `release()` is idempotent and must not destroy Engine-owned replica state.

## Store contract

A `ReplicaStore` returns a lease with `load`, `append`, `flush`, optional snapshot replacement, and `close`. Persistence state is reported separately from Provider state. Without a Store, construction requires the explicit `{ mode: "volatile" }` marker and snapshots remain `persistence: "volatile"`.

## Presence safety

Presence is ephemeral and non-authoritative. Selections are encoded as Yjs relative positions internally. Display fields are length- and format-bounded; avatar URLs require HTTPS; invalid colors use a safe default. Hosts must render names as text and must never use Presence as proof of identity, membership, or authorization.

## Dependencies

- `yjs@13.6.32` (MIT), peer + development dependency: CRDT document, shared text, relative positions, and scoped UndoManager.
- `y-protocols@1.0.7` (MIT), direct dependency: Awareness wire semantics.

Bundle reference on 2026-09-03: the minified browser bundle for the default entry, with `@floatboat/nexus-core` external and the assessment entry excluded, is 104,529 bytes (31,708 bytes gzip). This is evidence, not a release budget.

Replacing these dependencies would require a data-format migration, convergence and history requalification, Provider protocol replacement, Presence compatibility work, and replay testing of stored updates. Yjs 14 `@y/*` packages are intentionally excluded from this dependency graph.

## Electron demonstration

Run `pnpm dev:electron-demo`, then choose **Collaborate**. The lab opens two Editors backed by two Engines and the local assessment Provider. The UI visibly reports transport/sync/peer/persistence state and warns that the demo is volatile, unauthenticated, and not crash-safe.
