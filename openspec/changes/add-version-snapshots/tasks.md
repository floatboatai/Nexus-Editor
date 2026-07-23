## 1. OpenSpec and Test-First Setup

- [x] 1.1 Create OpenSpec change `add-version-snapshots`.
- [x] 1.2 Define the `plugin-snapshots` scope and core / diff-UI non-goals.
- [x] 1.3 Add red tests for the snapshot engine and plugin before implementation.

## 2. Plugin Package Implementation

- [x] 2.1 Scaffold `packages/plugin-snapshots` (package.json, tsconfig, tsup build) matching `plugin-wordcount`.
- [x] 2.2 Add the async `SnapshotStore` interface and `createMemorySnapshotStore()`; no implicit persistence.
- [x] 2.3 Implement the snapshot engine: capture with FNV-1a content-hash de-dup, label trimming, per-document keying, `maxSnapshots` retention, storage-failure resilience, and serialized async operations.
- [x] 2.4 Implement `createSnapshotsPlugin()`: `snapshots.capture` editor command, idle-based auto-capture, safe restore (safety snapshot + undoable `setDocument`), delete/clear, and a subscribe/listen API for hosts.
- [x] 2.5 Wire `attachSnapshotsPlugin()` following the `plugin-wordcount` attach pattern.
- [x] 2.6 Add the vitest alias and workspace registration for the new package.

## 3. Tests

- [x] 3.1 Engine tests: de-dup, retention, label rules, per-key isolation, missing-id no-ops, store failure resilience.
- [x] 3.2 Plugin tests against a real `createEditor` (jsdom): command capture, idle auto-capture with fake timers, safe restore (safety snapshot + undo), subscribe emissions.
- [x] 3.3 Memory store round-trip test (persistence contract used by hosts).

## 4. Electron Demo Reference Implementation

- [x] 4.1 Add `snapshots:*` IPC handlers in `electron/main.ts` persisting under `<vault>/.nexus/snapshots/<document-hash>/` (content `.md` + metadata `.json` sidecar).
- [x] 4.2 Exclude dot-directories from the vault tree walker and `readAll` so snapshot storage stays invisible.
- [x] 4.3 Expose a `snapshots` bridge in `electron/preload.ts` and `bridge.d.ts`.
- [x] 4.4 Add `snapshots-panel.ts` (list / capture / restore-with-confirm / delete) and a toolbar toggle button.
- [x] 4.5 Wire the plugin in `editor-shell.ts` with `getDocumentKey()` from the active file and capture-on-save in `app.ts`.
- [x] 4.6 Launch the built demo and verify the main process boots cleanly with the snapshot IPC handlers (interactive capture/restore/delete flows are covered by the plugin unit tests; manual UI walkthrough steps are listed in the PR description).

## 5. Documentation

- [x] 5.1 Write `packages/plugin-snapshots/README.md` (usage, options, `SnapshotStore` contract).
- [x] 5.2 Add the plugin to the root `README.md` plugin list.
- [x] 5.3 Update `docs/ROADMAP.md` #19 status to `in-progress` with a link to this change.

## 6. Verification

- [x] 6.1 Run the targeted `plugin-snapshots` Vitest suite and confirm the new tests pass.
- [x] 6.2 Run `pnpm test`.
- [x] 6.3 Run `pnpm build`.
- [x] 6.4 Run `openspec validate add-version-snapshots --strict` (via npx) — change is valid.
