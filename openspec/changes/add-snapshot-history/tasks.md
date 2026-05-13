## 1. OpenSpec
- [x] 1.1 Scaffold `proposal.md`, `design.md`, `tasks.md`, and `specs/snapshot-history/spec.md`
- [ ] 1.2 Validate the change with `openspec validate add-snapshot-history --strict` (`openspec` CLI not installed in the local environment)

## 2. Main-process Persistence + IPC
- [x] 2.1 Add snapshot store read/write helpers in `apps/electron-demo/electron/main.ts`
- [x] 2.2 Persist snapshots in `userData/snapshots.json` with graceful fallback on missing/corrupt files
- [x] 2.3 Add IPC to create a snapshot for the current document
- [x] 2.4 Add IPC to list snapshots for a document key
- [x] 2.5 Enforce bounded retention per document (default 20 newest entries)

## 3. Preload + Types
- [x] 3.1 Extend `preload.ts` with `nexusDemo.snapshots.*`
- [x] 3.2 Extend `bridge.d.ts` with `SnapshotEntry` and snapshot bridge types

## 4. Renderer
- [x] 4.1 Extend renderer state with currently loaded snapshots
- [x] 4.2 Add `history-panel.ts` to render the snapshot list and actions
- [x] 4.3 Add a toolbar button or entry point to create a manual snapshot
- [x] 4.4 Wire panel refresh when the active document changes or a new snapshot is created
- [x] 4.5 Implement `Restore` with dirty-state confirmation
- [x] 4.6 Implement `Reuse` as a new unsaved draft loaded into the editor
- [x] 4.7 Add snapshot panel styles in `style.css`

## 5. Verification
- [x] 5.1 Add tests for snapshot storage helpers
- [x] 5.2 Add renderer tests for history panel rendering and restore/reuse actions
- [x] 5.3 Run relevant test suites and electron-demo build successfully
- [ ] 5.4 Manually smoke-test: create snapshot, relaunch app, restore snapshot, reuse snapshot as new draft
