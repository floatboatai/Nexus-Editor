## 1. Design
- [x] 1.1 Document CRDT ownership, initialization and provider boundaries.
- [x] 1.2 Specify selective undo, remote filters and table interaction policy.

## 2. Implementation
- [x] 2.1 Add generic history dispatch and source-table preview mode.
- [x] 2.2 Implement Yjs binding, selective undo and relative selections.
- [x] 2.3 Implement optional awareness with owned resource cleanup.
- [x] 2.4 Add package documentation and a runnable collaboration example.

## 3. Validation
- [x] 3.1 Test convergence under partitions, reordering and duplicate delivery.
- [x] 3.2 Test editor integration, undo, awareness and lifecycle cleanup.
- [x] 3.3 Run typecheck, public API checks, tests and builds.
- [x] 3.4 Validate OpenSpec and review the final diff.

## Validation results (2026-09-22)
- `pnpm test`: 72 files, 932 tests passed.
- `pnpm typecheck`: passed for the workspace.
- `pnpm build`: passed for all packages.
- `pnpm check:api`: passed, including the collaboration package's built declaration consumer.
- `pnpm --filter @floatboat/nexus-plugin-collab build:demo`: passed; Vite reports large chunks.
- `openspec validate add-crdt-collaboration --strict`: passed.
- `git diff --check`: passed.

Checks used the repository's pinned pnpm 9.15.4. The example was build-validated;
interactive browser smoke testing was not performed in this pass.
Maintainer approval remains pending as described in proposal.md.
