# Implementation Tasks

## 1. Package and public contracts

- [x] 1.1 Add `packages/plugin-collab` with package metadata, TypeScript config, build script, exports, and browser-safe dependencies.
- [x] 1.2 Define collaboration options, user/presence types, stable transaction-origin constants, and the plugin factory.
- [x] 1.3 Add explicit shared-document seeding and initialization helpers with no implicit per-client content insertion.
- [x] 1.4 Export collaboration-aware undo/redo commands and document history compatibility rules.

## 2. Incremental Yjs binding

- [x] 2.1 Implement local CodeMirror/Nexus change-to-`Y.Text` translation using one Yjs transaction per atomic editor update.
- [x] 2.2 Implement remote `Y.Text` delta-to-editor translation using one incremental transaction tagged `collab:remote` and excluded from local history.
- [x] 2.3 Prevent update echoes, duplicate observers, nested transaction recursion, and post-disposal delivery.
- [x] 2.4 Preserve selection mapping, AST refresh, Live Preview, slash state, and plugin update notifications on remote edits.
- [ ] 2.5 Handle remote updates safely during IME composition and active table/widget interactions.

## 3. Undo, presence, and lifecycle

- [x] 3.1 Integrate a per-binding `Y.UndoManager` that tracks only local-origin changes.
- [x] 3.2 Ensure collaborative undo/redo never removes remote-only edits and does not compete with ordinary history key bindings.
- [x] 3.3 Publish optional local awareness user/selection state using Yjs relative positions.
- [x] 3.4 Render and update remote selections/carets; ignore malformed or stale awareness safely.
- [x] 3.5 Dispose all Yjs observers, CodeMirror extensions, awareness state, decorations, commands, and timers idempotently.

## 4. Deterministic verification

- [x] 4.1 Add an in-memory update bus with controllable delay, ordering, duplication, disconnect, reconnect, and flush behavior.
- [x] 4.2 Add provider/lifecycle contract tests that run against at least two provider-shaped implementations.
- [x] 4.3 Add two-editor tests for inserts, deletes, replacements, multiline paste, initialization, remote origins, no echo, and AST/preview refresh.
- [ ] 4.4 Add concurrent-conflict tests for same-position insert, overlapping delete, delete-vs-insert, table edits, and batched plugin transactions.
- [ ] 4.5 Add local-only undo/redo tests before and after remote edits and reconnect.
- [x] 4.6 Add seeded randomized convergence tests; print and preserve failing seeds.
- [x] 4.7 Add lifecycle tests proving teardown is idempotent and leaves no observers, timers, awareness state, or editor contributions.

## 5. Real browser/Electron verification

- [ ] 5.1 Add an opt-in Electron collaboration demo mode that can open the same shared document in two windows.
- [x] 5.2 Add automated two-window smoke coverage for visible synchronization, remote cursor/presence, disconnect/reconnect, and byte-identical final Markdown.
- [ ] 5.3 Manually verify Chinese IME composition while the other window edits concurrently.
- [ ] 5.4 Manually verify every table interaction path while receiving remote updates: cell edit, range selection, column/row grip selection, drag reorder, outside deselect, and delete-key selection.

## 6. Performance and release gates

- [ ] 6.1 Benchmark a 10,000-line document with ten simulated peers and confirm remote edits use incremental transactions rather than full-document replacement.
- [ ] 6.2 Run a collaboration soak test and assert resource counts return to baseline after peer teardown.
- [x] 6.3 Run plugin-collab tests, full repository tests, typecheck, API checks, production builds, and Electron smoke suites.
- [x] 6.4 Document supported providers, initialization ownership, undo behavior, awareness schema, security boundary, and host integration examples.
- [x] 6.5 Update English/Chinese roadmap entries only after the corresponding acceptance gates pass.
