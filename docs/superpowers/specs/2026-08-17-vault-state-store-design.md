# Electron Vault State Store Design

**Date:** 2026-08-17

**Scope:** `apps/electron-demo/electron`

**Status:** Implemented and locally verified

## Summary

Extract persisted Vault history from `electron/main.ts` into a dedicated `VaultStateStore`. The store will serialize all state operations, replace `vault.json` atomically, quarantine unreadable state, enforce recent-Vault invariants, and expose a drain point for Electron shutdown.

This is an internal Electron bug fix and module extraction. It does not add a public capability, alter an IPC contract, or require an OpenSpec proposal.

## Context

The Electron main process persists the last opened Vault and up to ten recent Vault paths in `<userData>/vault.json`. Both host modes use this file:

- runtime mode updates it from `nexus:vault:commit`
- legacy mode updates it from `vault:set-last` and repairs it from `vault:get-last`

The current implementation performs an uncoordinated read-modify-write in each handler and writes JSON directly to the target file. Two windows can therefore read the same state and overwrite each other's updates:

```text
initial state: [old]

window A reads [old]
window B reads [old]
window A writes [A, old]
window B writes [B, old]

final state: [B, old]
```

The update for `A` is lost. A process interruption during the direct write can also leave malformed JSON. The next read silently returns an empty state, so the user loses all recent-Vault history without any retained evidence of the damaged file.

`ElectronPluginStorageBroker` already addresses the same filesystem reliability concerns for a different data model with serialized operations, same-directory temporary files, atomic replacement, and corrupt-file quarantine. Vault state should use the same reliability principles without being forced into the plugin storage revision protocol.

## Goals

- Preserve every recent-Vault update issued by concurrent windows in one Electron main process.
- Ensure readers observe either the previous complete JSON document or the next complete JSON document.
- Preserve malformed state as a quarantined file before recovering to an empty state.
- Keep MRU ordering, exact-path deduplication, and the ten-entry limit in one module.
- Keep runtime and legacy host modes on the same store instance and behavior.
- Keep the main-process handlers focused on IPC authorization and orchestration.
- Make the concurrency and recovery behavior testable without launching Electron.
- Add no runtime dependency and make no public contract change.

## Non-Goals

- No recent-project picker or other product UI.
- No Markdown document autosave.
- No cross-process or distributed file locking. The design coordinates one Electron main process.
- No path canonicalization, case folding, or symlink identity changes. Exact string equality remains the deduplication rule.
- No revision field or migration of Vault state into plugin storage.
- No change to preload, renderer, or IPC request and response shapes.
- No guarantee that data survives power loss before the operating system flushes it to stable storage.

## Alternatives Considered

### Add a Promise mutex around the existing functions

This would prevent lost updates with the smallest diff, but direct target-file writes and silent corruption recovery would remain. Persistence rules would also stay embedded in `main.ts`. The result would fix only one symptom and provide little reusable test surface.

### Add a dedicated `VaultStateStore`

This is the selected design. It gives Vault history a small domain interface while hiding sequencing, validation, recovery, and file replacement. It is scoped to one Electron concern and follows an existing repository pattern.

### Generalize plugin storage into a revisioned JSON store

This could share more implementation, but Vault MRU state and plugin-owned revisioned documents have different invariants and error contracts. Generalization would expand the change into a security-sensitive module and create an abstract interface with only speculative callers. That risk is not justified for this fix.

## Module Structure

The Electron main-process files will be organized as follows:

```text
apps/electron-demo/electron/
├── atomic-file.ts
├── vault-state-store.ts
├── plugin-host-broker.ts
└── main.ts
```

### `atomic-file.ts`

This internal helper will expose one operation:

```ts
export function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
): Promise<void>;
```

It will:

1. create a uniquely named temporary file in the target directory
2. write the complete payload to that temporary file
3. rename the temporary file to the target path
4. attempt to remove the temporary file if writing or renaming fails
5. rethrow the original error

The existing private generic atomic-write helper in `plugin-host-broker.ts` will move to this module. `ElectronPluginStorageBroker` and `VaultStateStore` will be its two consumers. The broker-local `atomicTemporaryPath` function will remain because the security-checked `ElectronVaultBroker.atomicWriteAuthorized` path still uses it directly. The shared helper will preserve the same temporary filename pattern.

Atomic replacement prevents other readers from observing a partially written JSON document. It is not described as full durability because the design does not add file and directory `fsync` operations.

### `vault-state-store.ts`

The module will own the persisted state type and invariants:

```ts
export interface VaultState {
  readonly lastVault: string | null;
  readonly recents: readonly string[];
}

export class VaultStateStore {
  constructor(filePath: string, options?: VaultStateStoreOptions);

  read(): Promise<VaultState>;
  recordRecent(vaultPath: string): Promise<VaultState>;
  pruneUnavailable(): Promise<VaultState>;
  drain(): Promise<void>;
}
```

`VaultStateStoreOptions` is an internal test seam, not a package export. It may inject the clock, path-existence check, atomic writer, and quarantine rename operation. Production defaults use `Date.now`, `existsSync`, `atomicWriteFile`, and `rename`.

The returned state objects and `recents` arrays will be immutable snapshots so callers cannot mutate the store's logical state outside an operation.

## State Invariants

Every state returned or written by the store will satisfy these rules:

- `lastVault` is a string or `null`.
- `recents` contains strings only.
- `recents` contains no exact duplicate paths.
- `recents` contains at most ten paths.
- `recordRecent(path)` places `path` first and preserves the relative order of the other unique entries.
- Paths are not trimmed, resolved, case-folded, or otherwise rewritten.
- An empty path passed to `recordRecent` is rejected with a `TypeError` rather than persisted.

The parser remains tolerant of the existing unversioned JSON shape. Missing or invalid individual fields normalize to their empty values. A top-level value that is not an object, or JSON that cannot be parsed, is treated as corrupt.

## Concurrency Model

One `VaultStateStore` instance will be shared by every runtime and legacy IPC handler in the Electron main process.

Every accepted state-access operation (`read`, `recordRecent`, and `pruneUnavailable`) enters one FIFO Promise queue. Input validation that rejects an invalid `recordRecent` call runs before the queue and touches no disk. A mutating operation performs its read, state transition, and atomic write inside one queue entry. No other operation can observe or modify the file between those steps. `drain()` does not enqueue work; it captures the current queue tail.

Mutating operations call a private, non-queued `readFromDisk()` helper after they acquire their queue slot. They must not call the public `read()` method from inside a queued operation, because that would enqueue work behind the operation that is currently waiting for it and deadlock the queue.

```text
recordRecent(A) ─┐
recordRecent(B) ─┼─> FIFO queue -> read -> transition -> atomic replace
read() ──────────┘
```

If an operation rejects, its caller receives the error, but the queue tail is converted back to a fulfilled state before accepting the next operation. A failed write therefore does not permanently poison persistence for the rest of the application session.

This ordering guarantee applies only within the singleton store. Multiple operating-system processes that point at the same `userData` directory are outside the design scope.

## Read and Recovery Behavior

### Missing file

`read()` returns:

```ts
{ lastVault: null, recents: [] }
```

It does not create `vault.json` until a mutation needs to persist state.

### Valid or partially valid object

The store normalizes fields and returns an immutable snapshot. Invalid entries in `recents` are removed, duplicate paths retain their first occurrence, and entries beyond the limit are discarded.

The private disk-read result also records whether normalization changed the persisted representation. `pruneUnavailable()` rewrites the file when paths were pruned or the valid object required normalization; an already canonical state is not rewritten.

### Malformed JSON or invalid top-level value

The store attempts to rename:

```text
vault.json -> vault.json.corrupt-<timestamp>
```

It then returns the empty state. If quarantine itself fails, the original file is left in place and the empty state is still returned. The disk-read result records that the source remains non-canonical, so the next mutating operation (`recordRecent` or `pruneUnavailable`) recovers service by atomically replacing the target. A read-only `read()` remains non-fatal and does not overwrite the damaged evidence.

Quarantine happens inside the same FIFO queue as all other operations, so a concurrent `recordRecent` cannot race with the recovery rename.

## Mutation Behavior

### `recordRecent(vaultPath)`

Inside one queue operation, the method will:

1. read and normalize the current state
2. remove exact occurrences of `vaultPath` from `recents`
3. prepend `vaultPath`
4. truncate the result to ten entries
5. set `lastVault` to `vaultPath`
6. atomically persist the next state
7. return the immutable next-state snapshot

### `pruneUnavailable()`

Inside one queue operation, the method will:

1. read and normalize the current state
2. remove recent paths for which the injected existence check returns false
3. set `lastVault` to `null` when it no longer exists
4. skip the write only when no path was pruned and the persisted object was already canonical
5. atomically persist and return the repaired state when pruning or normalization changed it

This replaces the current `vault:get-last` read-then-write cleanup and prevents cleanup from overwriting a concurrent commit.

### `drain()`

`drain()` captures and waits for the current queue tail. It is used during Electron shutdown so state writes already accepted by the store can settle before the process exits. Operations enqueued after the drain call are not part of that drain snapshot.

## Main-Process Integration

`main.ts` will lazily create one store for:

```text
path.join(app.getPath("userData"), "vault.json")
```

The IPC handlers will use it as follows:

| Handler | Store operation |
|---|---|
| `nexus:vault:commit` | `recordRecent(root)` |
| `nexus:vault:restore` | `pruneUnavailable()`, then restore `lastVault` when present |
| `vault:set-last` | `recordRecent(vaultPath)` |
| `vault:get-last` | `pruneUnavailable()` |

The old `VaultState`, `vaultStatePath`, `readVaultState`, and `writeVaultState` declarations will be removed from `main.ts`.

The existing quit drain will wait for both `ElectronPluginStorageBroker` and `VaultStateStore`. Shutdown will continue to use bounded fallback behavior; a stuck state write must not prevent the existing forced-exit deadline.

No preload or renderer change is required because all IPC contracts remain unchanged.

## Error Handling

- Invalid `recordRecent` input fails before touching disk.
- A read error other than file absence follows the same quarantine-and-empty recovery path as malformed JSON.
- A failed atomic write rejects the initiating IPC request and leaves the previously committed target file intact when the platform rename semantics permit it.
- Temporary-file cleanup is best effort and never replaces the original write error.
- A rejected operation does not block later queued operations.
- Corrupt state recovery is non-fatal because recent Vault history is reconstructable metadata, not user-authored document content.

## Testing Strategy

### `vault-state-store.test.ts`

Node-environment tests will cover the module through its public interface:

1. missing file returns the empty state without creating a file
2. valid state is parsed into an immutable snapshot
3. invalid fields are normalized, duplicates are removed, and the entry limit is enforced
4. malformed JSON is quarantined with a deterministic timestamp
5. quarantine failure still returns an empty state
6. `recordRecent` maintains MRU order and exact-path deduplication
7. more than ten recorded paths retain the ten newest entries
8. concurrent `recordRecent` calls preserve every update in invocation order
9. `pruneUnavailable` removes missing entries and clears a missing `lastVault`
10. unchanged pruning does not rewrite the target
11. a failed write rejects that call but does not poison the queue
12. a later successful write recovers after an earlier failure
13. an invalid top-level JSON value is quarantined
14. pruning repairs the target when quarantine failed and left corrupt source in place
15. a read queued behind a pending write observes the committed state
16. `drain()` waits for accepted work that is still pending
17. temporary test directories are removed after every test

Tests will use real temporary directories for filesystem behavior. Injectable dependencies will be limited to deterministic failure and time scenarios that cannot be exercised portably with filesystem permissions.

### `atomic-file.test.ts`

Focused Node-environment tests will verify:

- successful replacement leaves the complete target and no temporary sibling
- a rename failure rethrows the original error and removes the temporary sibling
- temporary test directories are removed after every test

### Main-process integration

`electron-main-window-host.test.ts` will add a focused regression scenario showing that two windows can submit recent-Vault updates concurrently and that the resulting state contains both paths. The test should cross the main-process handler seam rather than duplicate the store's state transition logic.

Existing plugin storage tests remain the regression coverage for the extracted `atomicWriteFile` helper's other consumer.

### Verification commands

Implementation is not complete until these commands pass:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:electron-demo
pnpm --filter @floatboat/nexus-electron-demo smoke:multi-window
```

## Acceptance Criteria

The change is complete when all of the following are true:

1. runtime and legacy Vault history handlers share one `VaultStateStore`
2. two concurrent recent-Vault updates cannot lose either path
3. every persisted state satisfies the MRU, uniqueness, type, and size invariants
4. target replacement uses a same-directory temporary file and rename
5. malformed state is preserved under a `.corrupt-<timestamp>` name when quarantine succeeds
6. a failed operation does not prevent a later operation from succeeding
7. existing IPC contracts remain byte-for-byte type compatible
8. existing plugin storage behavior remains unchanged after atomic helper extraction
9. shutdown waits for accepted Vault state writes within the existing bounded quit flow
10. targeted tests, the full suite, typecheck, package builds, Electron build, and multi-window smoke pass

## Risks and Mitigations

### Atomic rename differs across filesystems

The temporary file is created in the target directory so source and target stay on the same filesystem. Tests avoid assumptions about inode identity and assert only the supported complete-file replacement behavior.

### Cleanup could erase a concurrent update

`pruneUnavailable` uses the same queue as `recordRecent`, making cleanup an ordered state transition instead of a separate read and write.

### A rejected operation could stall all later writes

The internal queue records each caller's rejection while maintaining a fulfilled tail for subsequent work. Recovery after failure is an explicit test case.

### Helper extraction could regress plugin storage

The extracted helper keeps the existing temporary-name and cleanup behavior. Existing `ElectronPluginStorageBroker` tests must pass unchanged, and focused helper tests cover the moved implementation.

### The change could grow into product-level recent-project behavior

The store remains main-process infrastructure. No renderer UI, new IPC endpoint, or recent-project workflow is included.

## Expected File Changes

```text
apps/electron-demo/electron/atomic-file.ts                         new
apps/electron-demo/electron/vault-state-store.ts                  new
apps/electron-demo/electron/plugin-host-broker.ts                 helper import only
apps/electron-demo/electron/main.ts                               store integration
apps/electron-demo/test/atomic-file.test.ts                       new
apps/electron-demo/test/vault-state-store.test.ts                 new
apps/electron-demo/test/electron-main-window-host.test.ts         regression coverage
docs/superpowers/specs/2026-08-17-vault-state-store-design.md     this design
```

No package manifest, lockfile, public package documentation, renderer source, or OpenSpec delta is expected to change.

## PR Shape

The implementation should remain one reviewable PR with this design document and no unrelated cleanup. The PR description should lead with the concrete two-window lost-update sequence, explain why a store is preferable to a mutex in `main.ts`, and report the exact verification commands and results.

The intended title is:

```text
fix(electron): make Vault state persistence atomic
```
