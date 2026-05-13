## Context

The product direction increasingly points toward local-first note and writing workflows. The electron demo already has vault navigation, slash commands, live preview, and file persistence, but it still lacks a lightweight mechanism for checkpointing document evolution beyond linear undo/redo.

The requested user value is practical rather than archival:
- "What did I have a few minutes ago?"
- "Can I roll back to a previous draft?"
- "Can I reuse an earlier draft without overwriting the current note?"

That makes full-blown version-control semantics unnecessary for v1. We can satisfy the workflow with host-managed snapshots in the demo app.

## Goals / Non-Goals

**Goals:**
- Let users manually create a named-or-untitled snapshot of the current editor content.
- Let users view recent snapshots for the active document in reverse chronological order.
- Let users restore a snapshot into the current editor session.
- Let users reuse a snapshot as a new unsaved draft, so old content can seed a fresh edit without mutating the original file on disk.
- Persist snapshots across app restarts.
- Keep the implementation small, testable, and entirely within `apps/electron-demo`.

**Non-Goals:**
- Automatic time-travel on every keystroke.
- Cross-device sync, collaboration, CRDT, or Git integration.
- Prompt history, model output history, or AI conversation state.
- A public snapshot API in `@floatboat/nexus-core`.
- Branching timelines, diffs, merge UI, or retention policies beyond a simple cap.

## Decisions

**Decision: Scope v1 to Electron demo, not `@floatboat/nexus-core`.**
The core editor is intentionally storage-agnostic and single-document oriented. Snapshots require persistence, file identity, retention, and UI decisions that belong to the host app. Keeping this in the demo avoids prematurely locking the core into a storage contract that other hosts may not want.

Alternatives considered:
- Add snapshot primitives to `@floatboat/nexus-core`: rejected because core should not own persistence concerns.
- Create a reusable `plugin-snapshots` package immediately: rejected because there is only one host implementation today, and the right abstraction is not yet proven.

**Decision: Manual snapshots only for v1.**
Manual snapshots provide clear user intent and avoid complex policies around debounce intervals, snapshot spam, and retention pressure. They also keep testing and UX straightforward.

Alternatives considered:
- Auto-snapshot on every save: useful, but easy to add later once the storage and panel UX exist.
- Auto-snapshot on timer or debounce: rejected as too noisy for the first slice.

**Decision: Persist snapshots in `app.getPath("userData")/snapshots.json`.**
This matches the existing vault persistence pattern and avoids new dependencies. The storage file will contain an index keyed by document identity, plus a per-document list of snapshot entries.

**Decision: Key snapshots by document identity with an untitled fallback.**
For saved files, the key is the normalized absolute path.
For unsaved docs, the key is a synthetic scope such as `untitled`.
This keeps retrieval deterministic while still allowing snapshots before first save.

**Decision: "Reuse" means load snapshot content as a new unsaved draft.**
This best matches the product language without requiring duplication-on-disk flows. Reusing a snapshot clears the active file association in the renderer state, marks the document dirty, and lets the user decide where to save it.

Alternatives considered:
- "Reuse" as copy-to-clipboard: too weak, does not feel like a real editing workflow.
- "Reuse" as create sibling file automatically: too opinionated and would require naming UX plus filesystem writes.

**Decision: Retain a bounded number of snapshots per document.**
Keep the newest `N` snapshots per document, with `N = 20` as the proposed default. This prevents unbounded growth while remaining generous enough for demo use.

## Data Model

Suggested persisted shape:

```ts
interface SnapshotEntry {
  id: string;
  docKey: string;
  filePath: string | null;
  title: string;
  content: string;
  createdAt: string; // ISO timestamp
  summary: string;   // first non-empty line or truncated preview
}

interface SnapshotStore {
  byDocument: Record<string, SnapshotEntry[]>;
}
```

Notes:
- `title` is display-oriented metadata, not a required user-entered field.
- `summary` avoids rendering full document content in the list by default.
- `content` stores the full markdown payload so restore/reuse does not need the original file to still exist.

## UI Flow

Renderer additions:
- A toolbar action or button: `Snapshot`
- A side panel: `History`
- Each history item shows:
  - timestamp,
  - file label / untitled label,
  - summary preview,
  - actions: `Restore`, `Reuse`

Behavior:
- `Restore` replaces the current editor document after a dirty-state confirmation when needed.
- `Reuse` loads the snapshot content into the editor as a new unsaved draft:
  - `state.filePath = null`
  - `state.activeFile = null`
  - `state.dirty = true`

## Risks / Trade-offs

- **Snapshot list grows large** → bounded retention per document mitigates this.
- **Unsaved-document identity is coarse** → acceptable for v1; later iterations can add per-session untitled ids if needed.
- **Restore may surprise users if it mutates the current document abruptly** → confirm when dirty and keep the action clearly labeled.
- **Storage file corruption** → follow the vault-state pattern: fall back to an empty store if JSON parse fails.

## Migration Plan

Net-additive only. No existing user data needs migration.

If the project later introduces a generalized snapshot service or a reusable package, the demo's `snapshots.json` format can be migrated in place because each snapshot entry is self-contained.

## Open Questions

- Should saving a file optionally create a snapshot automatically after v1?
- Should the panel allow deletion of individual snapshots in v1, or is bounded retention sufficient?
- Should snapshot timestamps be grouped by day in the UI, or kept as a flat list for the first implementation?
