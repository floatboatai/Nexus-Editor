## 1. Proposal

- [x] 1.1 Review Roadmap #23 and existing Electron vault IPC surface.
- [x] 1.2 Define proposal goals, non-goals, expected files, and impact.
- [x] 1.3 Define design boundary and validation strategy.
- [x] 1.4 Run `openspec validate add-cloud-storage-interface --strict`.
- [ ] 1.5 Submit proposal PR and wait for approval before implementation.

## 2. Interface Design

- [ ] 2.1 Decide whether the contract lives in `@floatboat/nexus-core` as dependency-free types or in a new storage package.
- [ ] 2.2 Finalize `NoteVaultAdapter`, `NoteVaultRef`, `NoteVaultNode`, capability, write-result, and error types.
- [ ] 2.3 Define revision/etag semantics for optimistic writes.
- [ ] 2.4 Define optional watch/change event semantics.
- [ ] 2.5 Define unsupported-operation, auth-required, permission-denied, conflict, offline, and unknown error shapes.

## 3. Future Implementation

- [ ] 3.1 Add exported TypeScript contract in the approved package/module.
- [ ] 3.2 Add in-memory adapter for contract tests.
- [ ] 3.3 Adapt electron-demo local vault behavior behind the contract without changing current user flows.
- [ ] 3.4 Preserve path-escape validation in the local filesystem adapter.
- [ ] 3.5 Document host-owned provider responsibilities and cloud SDK non-goals.

## 4. Future Tests

- [ ] 4.1 Contract tests cover list/read/write/create/rename/delete.
- [ ] 4.2 Conflict tests cover stale revision/etag writes.
- [ ] 4.3 Capability tests cover unsupported watch/trash/rename operations.
- [ ] 4.4 Boundary tests prove local filesystem refs cannot escape the vault root.
- [ ] 4.5 Electron-demo smoke test covers existing vault workflows after refactor.

## 5. Documentation / Roadmap

- [x] 5.1 Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md` with this OpenSpec change id.
- [ ] 5.2 Add README/API docs in the implementation PR if public types are introduced.
- [ ] 5.3 Keep implementation PR separate from this proposal PR.
