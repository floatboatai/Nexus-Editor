# Tasks: fix-document-load-undo-boundary

## Phase 1: Spec and failing tests

- [x] 1.1 Create `openspec/changes/fix-document-load-undo-boundary/proposal.md`, `design.md`, `tasks.md`, and `specs/editor-core/spec.md`
- [x] 1.2 Add red tests for the `history` option in `packages/core/test/editor.test.ts` (default records, `skip`, `reset`, redo isolation, `reset` and `skip` without a history extension, IME-deferred load)
- [x] 1.3 Add red integration tests in `apps/electron-demo/test/editor-shell.test.ts` for the `loadDocument` boundary and for isolation between two live shells
- [x] 1.4 Re-point the two `packages/plugin-history/test/plugin-history.test.ts` cases that assumed `setDocument` is undoable, and add a `reset` isolation case
- [x] 1.5 Run the targeted suites and confirm the new cases fail for the expected reason before implementing

## Phase 2: Core API

- [x] 2.1 Add `history?: "record" | "skip" | "reset"` and its JSDoc to `SetDocumentOptions` in `packages/core/src/types.ts`
- [x] 2.2 Annotate `performSetDocument` in `packages/core/src/editor.ts`: `Transaction.addToHistory.of(false)` for `skip`/`reset`
- [x] 2.3 Add the optional `historyCompartment` marker to `NexusPlugin` (`packages/core/src/types.ts`) and declare it in `createHistoryPlugin()`
- [x] 2.4 Give `createEditor` a per-editor `historyCompartment` that installs the declaring plugin's `cmExtensions`
- [x] 2.5 For `reset`, drop the compartment and install a fresh history instance in the load transaction; skip both dispatches when no history plugin is present

## Phase 3: Integration and docs

- [x] 3.1 Pass `history: "reset"` from `EditorShell.loadDocument` in `apps/electron-demo/src/renderer/editor-shell.ts`
- [x] 3.2 Document the option and the load-boundary semantics in `README.md`
- [x] 3.3 Confirm the targeted suites pass

## Phase 4: Validation

- [ ] 4.1 `pnpm typecheck`
- [ ] 4.2 `pnpm test`
- [ ] 4.3 `pnpm check:api`
- [ ] 4.4 `pnpm build` and `pnpm build:electron-demo`
- [ ] 4.5 Manual check in electron-demo: open → Ctrl+Z (no change) → edit → Ctrl+Z (back to loaded content) → Ctrl+Shift+Z → open another file → Ctrl+Z (does not restore the previous file)
- [ ] 4.6 Run `openspec validate fix-document-load-undo-boundary --strict` if the OpenSpec CLI is available
