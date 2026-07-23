# @floatboat/nexus-plugin-snapshots

Version history for Nexus-Editor: capture point-in-time snapshots of the current document, list them per file, and restore any of them — with host-injected persistence and no implicit `localStorage` / filesystem writes.

Reference implementation of [Roadmap #19](../../docs/ROADMAP.md) ("Version history / snapshots"); see `openspec/changes/add-version-snapshots` for the spec.

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  attachSnapshotsPlugin,
  createSnapshotsPlugin
} from "@floatboat/nexus-plugin-snapshots";

const snapshots = createSnapshotsPlugin({
  // Optional — defaults to an in-memory store:
  store: mySnapshotStore,
  // Snapshots are scoped per key (e.g. the active file path):
  getDocumentKey: () => activeFilePath ?? "untitled",
  maxSnapshots: 50,
  // Optional age-based expiry — pruned on capture and via prune():
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  autoCapture: { intervalMs: 30_000 } // one snapshot after 30s idle
});

const editor = createEditor({ container, plugins: [snapshots] });
attachSnapshotsPlugin(snapshots, editor);

await snapshots.capture("First draft");   // manual capture
const list = await snapshots.list();       // newest first
await snapshots.restore(list[0].id);       // safe + undoable
await snapshots.remove(list[0].id);
```

A manual capture is also registered as the editor command `snapshots.capture` (label "Snapshots: Take snapshot"), so command palettes can trigger it via `editor.runCommand("snapshots.capture")`.

## Behavior

- **De-duplication** — capturing content identical to the newest snapshot is a no-op (`capture()` resolves `null`). Idle auto-capture therefore never grows the history of an unchanged document.
- **Safe restore** — before replacing the document, a safety snapshot of the current buffer (label `"Before restore"`) is taken unless the content is already preserved. The restore itself is a single `setDocument` transaction, so one `undo()` reverts it (with `plugin-history` installed).
- **Retention** — each document key keeps at most `maxSnapshots` entries (default 50); the oldest drop first. With `maxAgeMs` set, snapshots older than that are also pruned — lazily, on capture and when the host calls `prune()` (e.g. at app startup), never on a background timer.
- **Resilience** — a rejecting store never breaks the editor: failed saves resolve `null`, failed lists resolve `[]`, missing ids are no-ops.

## Persistence (`SnapshotStore`)

Storage is host-injected and fully async, so file / IPC / network backends are representable:

```ts
interface SnapshotStore {
  list(documentKey: string): Promise<SnapshotMeta[]>;
  load(documentKey: string, id: string): Promise<string | null>;
  save(documentKey: string, snapshot: Snapshot): Promise<void>;
  remove(documentKey: string, id: string): Promise<void>; // missing id must not throw
  clear(documentKey: string): Promise<void>;
}
```

The default `createMemorySnapshotStore()` keeps everything in memory — persistence only happens when the host explicitly provides a store. The electron-demo (`apps/electron-demo`) ships a file-backed store over IPC that writes snapshots into the vault under `.nexus/snapshots/`.

## API

| Export | Description |
|---|---|
| `createSnapshotsPlugin(options?)` | Plugin factory (dual shape: `NexusPlugin` + API handle) |
| `attachSnapshotsPlugin(plugin, editor)` | Bind to an editor (required for capture / restore / auto-capture) |
| `SNAPSHOTS_CAPTURE_COMMAND` | Editor command id for manual capture |
| `createMemorySnapshotStore()` | In-memory `SnapshotStore` (default) |
| `SnapshotEngine` | DOM-free snapshot bookkeeping (de-dup, retention) for custom integrations |
| `hashContent(content)` | FNV-1a content hash used for de-duplication |
