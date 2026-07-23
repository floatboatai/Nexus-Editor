# Change: Add Version History / Snapshots

## Why

Roadmap #19 ("Version history / snapshots") calls for point-in-time document snapshots with host-injected storage, so users can recover earlier versions of a note without any cloud dependency. This change delivers a new `@floatboat/nexus-plugin-snapshots` package plus the electron-demo reference implementation called out in the roadmap ("electron-demo lands the reference impl first").

## What Changes

- Add a new package `@floatboat/nexus-plugin-snapshots` exposing `createSnapshotsPlugin()`.
- Capture full-document snapshots manually (named editor command) and automatically (idle-based auto-capture after edits, opt-in).
- De-duplicate consecutive snapshots by content hash — an unchanged document never produces a new snapshot.
- Scope snapshots per document via a host-supplied `getDocumentKey()` (e.g. active file path); each key has an independent snapshot list.
- Enforce a configurable `maxSnapshots` retention cap per document, dropping the oldest snapshots first.
- Restore a snapshot through `EditorAPI.setDocument()` so the restore is itself undoable; automatically capture a safety snapshot of the current content before restoring.
- Support host-injected async storage (`SnapshotStore`) for persistence — the plugin ships an in-memory store and never touches `localStorage` or the filesystem implicitly.
- Treat unavailable storage, thrown store operations, and missing snapshot ids as recoverable.
- Electron demo: file-backed `SnapshotStore` over IPC (stored inside the vault under `.nexus/snapshots/`), a snapshots panel (list / capture / restore / delete), and capture-on-save.

## Non-Goals

- No diff / side-by-side comparison UI in this PR (list + restore only).
- No changes to `packages/core` — the plugin builds on the existing public `EditorAPI`.
- No cloud sync of snapshots; storage backend is the host's responsibility.
- No snapshot branching, naming beyond a single label, or per-range restore.
- No changes to the React / Vue bindings.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-snapshots/` (new package)
  - `apps/electron-demo/electron/main.ts` (snapshot IPC handlers)
  - `apps/electron-demo/electron/preload.ts` (snapshot bridge)
  - `apps/electron-demo/src/renderer/` (snapshots panel, shell + app wiring)
  - `vitest.config.ts` (package alias)
  - `README.md`, `docs/ROADMAP.md` (status/docs)
- Affected roadmap: reference implementation for Roadmap #19.
