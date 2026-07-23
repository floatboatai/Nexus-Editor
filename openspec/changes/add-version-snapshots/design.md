## Context

Roadmap #19 asks for "Version history / snapshots" with package ownership `core` + host storage. Investigation shows the plugin surface (`NexusPlugin.commands`, `EditorAPI.setDocument`, `on`/`off` events) already covers every hook this feature needs, and the `add-search-query-history` change established the host-injected storage precedent inside a plugin package. Building this as a plugin package therefore matches the repo's actual pattern better than extending `core`, and keeps the capability opt-in with zero cost for hosts that don't enable it.

## Goals / Non-Goals

- Goals:
  - Pure, deterministic snapshot engine (hash de-dup, retention) that is fully unit-testable without a DOM.
  - Async host-injected `SnapshotStore` so the electron-demo can persist snapshots as files over IPC.
  - Restore flow that is safe by construction: safety snapshot first, then an undoable `setDocument`.
  - Electron-demo reference implementation: file-backed store + snapshots panel.
- Non-Goals: diff UI, cloud sync, core API changes, React/Vue binding changes.

## Decisions

- **Decision 1: New plugin package, no core changes.**
  Alternatives considered: adding a snapshot API to `core`'s `EditorAPI`. Rejected — every operation (read document, replace document, observe changes, register commands) is already public; a `core` change would widen the stable API surface for a feature most hosts may not enable. `NexusPlugin.commands` gives the command-palette integration for free.

- **Decision 2: Async `SnapshotStore` interface.**
  `list` / `load` / `save` / `remove` / `clear` all return promises. The search-history storage is synchronous (`getItem`/`setItem`), which fits `localStorage` but cannot represent file or IPC backends — the exact backends Roadmap #19 targets. The plugin ships `createMemorySnapshotStore()` for tests and headless hosts.

- **Decision 3: Content-hash de-duplication against the newest snapshot.**
  Capture hashes the document (FNV-1a, no dependency) and skips the write when it matches the newest snapshot for the same document key. This makes idle auto-capture cheap and keeps "restore then capture" from bouncing. Only the newest snapshot is compared — older duplicates are left alone, so a user returning to an earlier state still gets a fresh, correctly-ordered snapshot.

- **Decision 4: Safety snapshot before restore.**
  `restore()` first captures the current buffer (labelled `Before restore …`) so an accidental restore is itself recoverable; the restore then goes through `setDocument`, which dispatches a single transaction and therefore remains one `undo()` step. The safety capture runs through the normal de-dup path, so it is skipped when the buffer already matches the restore target or the newest snapshot (e.g. an idle auto-capture that just recorded the same content) — the content is preserved either way. The restore's own `setDocument` also suppresses the pending idle auto-capture, so a restore never grows a duplicate of the restored content.

- **Decision 5: Per-document keying via `getDocumentKey()`.**
  The host tells the plugin which document is active (electron-demo: the absolute file path, falling back to a fixed "untitled" key). Snapshots for different files never interleave, and switching files re-keys all subsequent operations. A fixed string also works for single-document hosts.

- **Decision 6: Idle-based auto-capture.**
  When `autoCapture.intervalMs` is set, each `change` event (re)starts an idle timer; when the user pauses for the interval, one snapshot is taken. De-dup (Decision 3) guarantees no-op captures stay free. There is deliberately no wall-clock periodic mode: it snapshots unchanged documents and adds timer complexity for no user benefit.

- **Decision 7: Electron-demo stores snapshots inside the vault at `.nexus/snapshots/<document-hash>/`.**
  Snapshots travel with the vault (portable, vault-scoped) instead of living in Electron's `userData`. The vault tree walker skips dot-directories, so the folder stays invisible in the file panel and out of the link index. Each snapshot is a `<id>.md` content file plus a `<id>.json` metadata sidecar — append-only, no shared index file that could corrupt concurrent writes.

## Risks / Trade-offs

- Async store operations race with rapid capture/restore clicks → the plugin serializes engine operations on a per-plugin promise queue; UI-triggered calls simply queue up.
- Retention pruning deletes files the host might still hold ids for → `remove` of a missing id is a no-op, `load` of a missing id resolves `null`, and `restore(null)` is a no-op.
- Large documents make full-text snapshots heavy → out of scope to delta-encode; the retention cap bounds total size, and de-dup prevents idle growth.

## Migration Plan

Purely additive. Hosts that don't install the plugin see no change. No data migration.

## Open Questions

- Should a future change add a shared storage-adapter contract in `core` for all plugins (search history, snapshots, …)? Deferred — Roadmap #23 (cloud storage interface) is the right place to generalize.
