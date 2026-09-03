# `@floatboat/nexus-plugin-collab`

Experimental, browser-safe realtime collaboration for Nexus Editor. The package keeps a Yjs replica authoritative while each Nexus Editor remains a live projection of that replica.

## Support status

`experimental`. The repository now contains a complete local product path: the headless Engine and Workflow, authenticated Hocuspocus Provider, browser IndexedDB Store, Electron single-writer `node:sqlite` utility broker, Markdown File Projection with three-way conflict handling, and an Electron create/join/resume/leave UI.

This is a real Host integration, not the acceptance lab. It is not yet `production-supported`: the included server is a single-node reference deployment, and packaged multi-renderer crash qualification, external TLS/identity/backup operations, target-platform coverage, security review, performance traces, and long-running soak evidence remain open. The deterministic adapters under `@floatboat/nexus-plugin-collab/assessment` are development/test tools and must not be used as a production backend.

## Public entries

- `@floatboat/nexus-plugin-collab` — browser-safe Engine, Workflow, File Projection, types, and reconciliation logic. It does not import Node.js, Electron, filesystem, SQLite, or a server SDK.
- `@floatboat/nexus-plugin-collab/hocuspocus` — explicit browser Provider entry using authenticated Hocuspocus WebSocket sync. Host code supplies a short-lived token resolver.
- `@floatboat/nexus-plugin-collab/indexeddb` — explicit browser Store entry using native IndexedDB and checkpoint-safe compaction.
- `@floatboat/nexus-plugin-collab/assessment` — deterministic in-memory Provider/Store for tests and the developer lab only.

The default entry remains browser-safe even when a Host chooses the explicit Hocuspocus or IndexedDB adapters. Electron SQLite and the reference server live under `apps/`; neither is bundled into the reusable package.

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

`create()` is the only seeding operation. Like a strict join, durable create loads only the Store checkpoint and starts the Provider against an empty Replica: an old cache is neither applied nor exposed to the Provider. After authenticated synchronization confirms that the remote room is still empty, create replaces the checkpoint-bound cache, writes the schema, creation marker, and initial Markdown, and flushes the Store. Authentication failure or an already-created remote room leaves the old cache unchanged. `open()` never seeds content. By default, a valid durable local Replica may satisfy readiness so an enrolled document can resume offline. An invitation join uses `{ readiness: "require-authenticated-sync" }`: it loads only the Store checkpoint, synchronizes an empty Replica, validates authenticated remote state, then atomically replaces and flushes the cache with the complete remote snapshot before returning. This prevents reader or editor credentials from uploading a divergent join cache. A local-first or locally created Registry Replica cannot be upgraded into strict authority in place; strict reuse fails with `remote-authority-unavailable` without closing its existing owner. Concurrent handles remain independently closable.

Use `content: "require-match"` when the Editor must already represent the collaborative content. Use `content: "replace-editor"` only when the Host explicitly permits the replica to replace the Editor projection.

`attach()` also accepts `access: "read-only" | "read-write"`. It defaults to `read-write` for compatibility. Binding installation is an atomic readiness fence: Local Proposals received before the returned promise resolves are rejected with `collaboration-binding-not-ready`, remote Yjs changes observed during installation are reconciled from the current Replica, and only a final Editor/Replica match enables proposals. A Host Workflow passes the enrolled membership role explicitly, so a reader's Local Proposals are rejected by Core even while a durable Replica is temporarily available as `local-only`; Authoritative Updates continue to project into that Editor. Undo and Redo pass through the same live lifecycle, Binding access, and Provider authorization gate, so a later downgrade to read-only cannot create a Yjs update.

Each Binding also registers owner-scoped Editor-destroy cleanup through Core. Calling `editor.destroy()` directly disables and removes the Binding synchronously, including its Y.Text observer and Presence, while any asynchronous disposer failure is caught and reported as `editor-destroy-cleanup-failed`; it cannot later quarantine the live Replica through a stale authoritative source.

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

A Provider factory receives a browser-safe binary replica port. `prepare()` must not connect or mutate the replica. `start()` runs only after Store restore and schema validation are ready and resolves after authenticated initial synchronization. Provider state separates transport (`connecting`, `online`, `offline`), sync (`syncing`, `synced`, `stale`), authentication, and access. Credential rejection, expiry, and active revocation are distinct `denied`, `expired`, and `revoked` authentication states with stable `authentication-denied`, `authentication-expired`, and `authorization-revoked` diagnostics. A network disconnect remains a transport fact rather than an invented authentication verdict. `release()` is idempotent and must not destroy Engine-owned replica state.

The Hocuspocus adapter does not retain a second, unbounded log of document updates while offline. Its transport mirror remains the current Yjs state, incremental socket frames are omitted while disconnected, and the next authenticated state-vector handshake transfers exactly the missing state. Upstream timer batching is disabled so its pending buffer cannot bypass that bound; Awareness retains the provider's latest-state deduplication.

The real adapter is created from the explicit entry:

```ts
import { createCollaborationEngine } from "@floatboat/nexus-plugin-collab";
import { createHocuspocusProviderFactory } from "@floatboat/nexus-plugin-collab/hocuspocus";
import { createIndexedDbReplicaStore } from "@floatboat/nexus-plugin-collab/indexeddb";

const provider = createHocuspocusProviderFactory({
  url: "wss://collab.example.com",
  token: documentId => hostCredentials.tokenFor(documentId),
});
const engine = createCollaborationEngine({
  providers: provider,
  store: createIndexedDbReplicaStore({ databaseName: "nexus-collaboration" }),
});
```

Product URL policy accepts `wss:` endpoints and permits plaintext `ws:` only for loopback development (`localhost`, `127.0.0.0/8`, or `::1`). URL credentials, query strings, and fragments are rejected. Invitation acceptance is also bound to the adapter's canonical ServerUrl: a differently scoped envelope fails before its bearer credential or accepted-server state is activated.

## Store contract

A `ReplicaStore` returns a lease with ordered `load`, `append`, `flush`, checkpoint-bound snapshot replacement, and `close`. Store or lease shutdown stops accepting new lease operations immediately, but drains every operation accepted before shutdown before closing the underlying database connection. Persistence state is reported separately from Provider state. Without a Store, construction requires the explicit `{ mode: "volatile" }` marker and snapshots remain `persistence: "volatile"`.

The browser adapter stores binary Yjs updates in IndexedDB. The Electron Host keeps SQLite and database paths outside the renderer: one utility process owns the built-in `node:sqlite` database, while renderer leases cross an opaque MessagePort broker. Its Host composition hashes `(canonical ServerUrl, DocumentId)` with a versioned domain into the local Store key, isolating equal DocumentIds used by different servers. Legacy rows keyed by a bare DocumentId lack server provenance and remain quarantined instead of being guessed into a server namespace.

Store failure never becomes a false `clean` state. The Engine bounds its pending append queue to 256 operations and 16 MiB by default; callers may tighten those limits with `storeBackpressure.maxPendingOperations` and `storeBackpressure.maxPendingBytes`. Once an append fails or either bound is reached, it stops enqueueing individual updates, marks persistence failed, and tracks subsequent live changes as a dirty generation. `document.reconcilePersistence()`—exposed as Workflow/UI **Retry local persistence**—drains the old queue, loads and idempotently applies durable updates, then repeatedly replaces through the Store-owned checkpoint with the complete live Replica snapshot until the dirty generation is stable. It flushes before returning to `clean`.

## Host Workflow and File Projection

`createCollaborationWorkflow()` composes the Engine with Host-supplied invitation, connection, file, and metadata adapters. It keeps `create`, `join`, `resume`, safe attach, reconnect, reauthentication, persistence retry, conflict resolution, rename, and leave semantics in one state machine. `join` always selects authenticated-sync readiness before File Projection or Enrollment can attach; `resume` explicitly selects local-authority readiness so a previously enrolled durable Replica remains usable during an outage.

Reauthentication is a per-DocumentId operation. A Host adapter must not run overlapping credential generations: same-generation callers may share one reconnect, a newer staged credential remains pending until an explicit retry, and failed rollback must use compare-and-set so it cannot overwrite a newer active capability. Workflow callers receive a stable `reauthentication-in-progress` failure instead of running Binding resume twice. Leave/close settles an active refresh before releasing owned resources, and a refresh rechecks session lifecycle after the Provider grant so it cannot revive an Editor Binding during teardown.

The File Projection controller persists a Projection Base and uses optimistic atomic writes. Its watcher begins observing before the initial read but buffers events until that read and reconciliation establish the first ordered Projection Base, so a rename cannot make a late old-path read authoritative for the new path. Collaborative Document changes observed during that read are queued behind the same initial reconciliation and then processed against its Projection Base, rather than starting a concurrent file read or write. External changes are reconciled as `base + live Collaborative Document + incoming disk`; only provably safe one-sided or non-overlapping changes are applied automatically. Missing bases, overlapping edits, stale versions, delete, and I/O failures remain explicit states. Conflict choices are generation-checked so a stale UI action cannot overwrite a newer disk version.

The collaborative Markdown subscription immediately replays its current snapshot. Projection initialization records that same revision and Markdown before subscribing and treats the identical replay as observation confirmation, avoiding a false dirty state or redundant metadata CAS at startup.

The Electron Workspace uses a version-4 Enrollment envelope. It retains the version-3 active Enrollment, pending-creation, identity-tombstone, and path-deletion records and adds non-secret pending invitation joins bound to exact VaultId, sender, session, operationId, path, FileId, and DocumentId. Versions 1–3 remain readable and normalize to version 4 on a later mutation. Before remote create it durably records a pending creation intent and reads back an ambiguous save. Rename, forget, and pending-creation abandon compare the full expected identity. Forget/pending-creation abandon first writes a durable tombstone, so Projection Base rollback can restore only the identity removed by that exact operation and cannot overwrite a concurrent rename. If active Enrollment commit later fails, the current process can reuse its retained session; after restart, the user supplies the owner credential and the Host resumes with `projectionMode="enroll"` (falling back to create only after `document-not-found`). Explicit pending-creation abandon removes only the local recovery intent after best-effort cleanup and never claims to delete a remote document.

The Electron Host serializes collaboration openings with open-file, open-Vault, Save As, rename, and delete through one document-context transaction and revalidates path, Editor, Markdown, and generation while holding it. Invitation join then installs a Host precommit, persists its exact version-4 pending join, and promotes the Host fence before any Projection metadata or file write. Enrollment and the `enrollment-committed` phase are committed together; the exact Host fence is released before the pending record is cleared and the Workspace becomes active. Renderer close expires write authority but retains the enumerable blocking fence. After Host restart, the durable pending join recreates that fence. Recovery completes an Enrollment only from an exact committed Enrollment or exact Projection metadata—even a `base:null` identity left after the file write but before Base confirmation. With no Projection metadata, the outcome remains uncertain and fail-closed: the user may paste the same invitation again or explicitly abandon only the local coordination. Pending-join abandon never modifies the file and is prohibited once any Projection metadata exists; recovery must finish first, after which the ordinary exact-enrollment forget flow applies. If abandon or pre-projection rollback releases the Host fence but durable intent removal fails, the exact committed fence is restored before failure is returned. If final pending cleanup fails after Enrollment commit and Host release, the already-atomic active Enrollment plus committed pending record continue blocking conflicting lifecycle mutations and a later recovery finishes cleanup without another file write.

After that gate, delete atomically reserves the path (including directory descendants); enrollment create/commit/upsert/rename reject the reservation until trash and exact descendant Enrollment/Projection cleanup finish. Trash failure releases the permit, but post-trash coordination failure retains it. The Collaboration panel enumerates crash leftovers and requires an explicit **Retry safe recovery**, **Abandon pending join** (only without Projection metadata), **Abort stale delete**, **Finish deletion cleanup**, or **Finish enrollment cleanup** action. A pending creation or pending join blocks overlapping rename/delete until recovery or its permitted explicit abandon. If collaboration coordination after a filesystem rename fails, the Vault attempts a compensating rename and metadata rollback and reports incomplete compensation as an aggregate failure.

## Presence safety

Presence is ephemeral and non-authoritative. Selections are encoded as Yjs relative positions internally. Display fields are length- and format-bounded; avatar URLs require HTTPS; invalid colors use a safe default. Hosts must render names as text and must never use Presence as proof of identity, membership, or authorization.

## Dependencies

- `yjs@13.6.32` (MIT), peer + development dependency: CRDT document, shared text, relative positions, and scoped UndoManager.
- `y-protocols@1.0.7` (MIT), direct dependency: Awareness wire semantics.
- `@hocuspocus/provider@4.6.0` (MIT), direct dependency used only by the explicit `/hocuspocus` entry: authenticated WebSocket transport, Yjs sync, and reconnect behavior.

The default and explicit browser entries are checked independently so Node.js, Electron, filesystem, SQLite, and reference-server modules cannot leak into browser consumers. Bundle measurements are qualification evidence and must be recorded from the final tree; they are not a release budget.

Replacing these dependencies would require a data-format migration, convergence and history requalification, Provider protocol replacement, Presence compatibility work, and replay testing of stored updates. Yjs 14 `@y/*` packages are intentionally excluded from this dependency graph.

## Electron Host integration

Run `pnpm dev:electron-demo`, open a runtime Vault and Markdown file, then choose **Collaborate**. The command starts the runtime Host by default; `NEXUS_PLUGIN_PLATFORM=0 pnpm dev:electron-demo` is the explicit legacy compatibility path. The runtime Host opens the actual experimental workflow: create or join with a short-lived credential, recover or abandon a pending creation, visibly recover an interrupted pending join, resume persisted enrollment, inspect independent network/sync/auth/access/local-store/server/file states, invite a reader or editor, reconnect, reauthenticate or retry local persistence, resolve file conflicts, and leave without implicitly deleting either the local Markdown file or remote document. Use File → **New Collaboration Window** (`CmdOrCtrl+Shift+N`) to open a second runtime BrowserWindow through a user-reachable product command.

`pnpm --filter @floatboat/nexus-electron-demo smoke:startup` launches the built `nexus-app://editor/` renderer through the real sandboxed preload in both the default runtime mode and explicit legacy mode. It guards the shipped main/preload/renderer artifacts against a blank startup, but it does not qualify a packaged application, a complete workflow across multiple real renderers, or renderer/utility-process crash recovery.

The Electron Host reads the exact trusted WebSocket endpoints from `NEXUS_COLLAB_SERVERS` before opening a window (comma-separated, at most 16; default `ws://127.0.0.1:1234`). Remote endpoints must use WSS. The same configuration controls CSP, Provider admission, and the restricted Main-process invitation broker; pasting an invitation cannot add a trusted server. Restart the application after changing it. Invitations use a fixed, authenticated, bounded HTTP(S) route in Main, not renderer fetch or a general-purpose IPC proxy. See the [self-hosted deployment guide](../../apps/collab-server/deploy/README.md).

Built renderers now use a secure custom origin instead of `file://`. Existing Markdown, Enrollment and SQLite paths are unchanged. Origin-scoped demo appearance settings are not automatically copied from the previous origin; reapply them in Settings if needed. No old storage is deleted.

`pnpm qualify:collab-electron` builds the workspace and runs two independent Electron applications with separate Vaults and SQLite stores. The test drives the actual product DOM through create/invite/join, bidirectional editing and local-only undo, Presence, offline close/reopen, server restart, a renderer termination after confirmed persistence, reader restrictions, external file conflict recovery, and revocation/expiry/reauthentication. A separate local TLS proxy checks WSS and Main's HTTPS invitations with an isolated test CA; untrusted Node and Chromium clients must reject that certificate. No CA is installed globally. Use Node 22, OpenSSL on PATH, and a Linux display or `xvfb-run`; the exercised platform is Linux x64, not a packaged Windows/macOS claim. After building, `pnpm --filter @floatboat/nexus-electron-demo smoke:collaboration` reruns only this gate. `NEXUS_ELECTRON_COLLABORATION_SMOKE_SUITE=network|product|tls` selects a narrower diagnostic slice; the default is `all`.

Binding detach, direct Editor destruction, and Document, Workflow, Workspace, and Electron-product close are idempotent best-effort cleanups. Each attempts all resources it owns even if an earlier release fails; multiple failures are returned as `AggregateError` rather than silently short-circuiting teardown.

The **Developer lab** action inside that panel opens the old volatile two-Editor assessment harness. It is useful for deterministic inspection, but it is not product evidence.

## Reference server boundary

`apps/collab-server` is a runnable authenticated Hocuspocus 4.6 reference deployment with room-scoped reader/editor tokens, active revocation, trusted Presence identity, bounded frames, health/readiness probes, invitation delegation, and atomically persisted binary Yjs snapshots. It is suitable for local qualification and as an adapter reference.

It is deliberately single-node. A production Host still owns TLS termination, account/session issuance, signing-secret rotation, database selection and migration, backup/restore, monitoring, retention, horizontal scaling, and capacity/SLO decisions. See `apps/collab-server/README.md`; passing its loopback tests is not a hosted-service production claim.
