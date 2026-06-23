## Context

The current vault implementation lives in `apps/electron-demo` and exposes operations through Electron IPC:

- `vault:list`
- `vault:read`
- `vault:read-all`
- `vault:write`
- `vault:create-file`
- `vault:create-folder`
- `vault:rename`
- `vault:delete`
- `vault:get-last` / `vault:set-last`
- `vault:changed`

That design was correct for the first desktop demo because it kept filesystem access outside `@floatboat/nexus-core`. Roadmap #23 asks for the next abstraction layer: a storage interface that can describe note/vault operations across local filesystem and cloud-like backends without coupling core to Electron or any provider SDK.

## Target Outcome

The proposal should make a later implementation PR straightforward by answering:

- What interface must a storage adapter implement?
- Which paths/IDs are stable and which are provider-specific?
- How are note tree listing, file reads/writes, mutation operations, and change notifications represented?
- How do hosts surface conflicts, permission failures, auth failures, offline state, and unsupported operations?
- What is explicitly outside v1?

## Proposed Interface Shape

The exact TypeScript names can change during implementation, but the intended contract is:

```ts
export interface NoteVaultAdapter {
  readonly id: string;
  readonly label: string;
  capabilities: NoteVaultCapabilities;
  list(options?: NoteVaultListOptions): Promise<NoteVaultNode[]>;
  readAll?(options?: NoteVaultListOptions): Promise<NoteVaultFile[]>;
  read(ref: NoteVaultRef): Promise<NoteVaultFile>;
  write(ref: NoteVaultRef, content: string, options?: NoteVaultWriteOptions): Promise<NoteVaultWriteResult>;
  createFile(parent: NoteVaultRef, name: string, content?: string): Promise<NoteVaultFileRef>;
  createFolder(parent: NoteVaultRef, name: string): Promise<NoteVaultFolderRef>;
  rename(ref: NoteVaultRef, name: string): Promise<NoteVaultRef>;
  delete(ref: NoteVaultRef, options?: NoteVaultDeleteOptions): Promise<void>;
  watch?(listener: (event: NoteVaultChangeEvent) => void): () => void;
}
```

Important design choices:

- Use provider-owned refs rather than assuming POSIX paths. Local files can use absolute paths internally, but cloud providers may need opaque IDs.
- Include display paths for UI, but do not make display paths the only identity.
- Represent capabilities explicitly because not every backend can watch, trash, rename folders, or provide revision tokens.
- Writes should allow optimistic concurrency via an optional revision/etag token when the provider supports it.
- Let adapters expose an optional `readAll` batch path for startup/indexing. The shared helper falls back to bounded-concurrency `list` + `read` so providers are not forced to implement a batch endpoint.

## Decision: Contract First, Provider SDKs Later

Do not bundle Google Drive, Dropbox, S3, WebDAV, or any auth SDK in v1. Provider integrations can be separate packages or host code once the adapter contract is stable.

Rationale:

- Cloud SDKs bring auth, token refresh, rate limits, retry policy, and bundle-size concerns.
- Hosts already own identity and persistence decisions.
- The first implementation can prove the contract by adapting the existing Electron local vault.

## Decision: Keep Core Headless

The contract may be exported from core or from a small storage package, but it must not make core perform IO. Core should remain a headless editor engine. If core exports types, they are only contracts for hosts and plugins.

The implementation proposal should compare two options:

- `@floatboat/nexus-core` exports the minimal types.
- New package such as `@floatboat/nexus-storage` exports the adapter contract and helper tests.

The proposal leans toward core-exported types only if they remain dependency-free and do not add runtime IO behavior.

## Decision: Existing Electron Vault Is the Reference Backend

The existing Electron vault is the best first adapter target because it already covers:

- recursive tree listing
- markdown file filtering
- read/write/create/rename/delete
- change notification via watcher
- path-escape validation
- last-vault persistence

The implementation PR should adapt this behavior without removing the current user-facing demo flow.

## Boundary Validation

The design boundary is validated by these checks:

- No cloud provider SDK appears in core.
- No Electron, Node filesystem, or browser storage APIs are imported by core adapter types.
- Adapter refs can represent both local paths and opaque cloud IDs.
- All destructive or write operations can report unsupported, permission-denied, auth-required, conflict, offline, and unknown errors.
- Watch support is optional and capability-gated.
- Existing electron-demo vault behavior can be mapped onto the interface without losing path-escape checks.

## Test Plan

Proposal validation:

- `openspec validate add-cloud-storage-interface --strict`
- Search for unresolved conflict markers in the new OpenSpec files and Roadmap files.
- Confirm diff contains only OpenSpec + Roadmap files.

Implementation validation in a later PR:

- Adapter contract tests using an in-memory adapter.
- Local filesystem/electron adapter tests for list/read/write/create/rename/delete.
- Conflict tests for stale revision/etag writes.
- Capability tests for unsupported watch/trash/rename operations.
- Path/boundary tests proving local filesystem adapter cannot escape its vault root.
- Electron-demo smoke test for existing open/read/write/create/rename/delete/watch flows after refactor.

## Risks / Trade-offs

- Too much in core would violate headless design. Keep concrete IO out.
- Too little in the contract would force every host to invent incompatible semantics. Define errors, refs, capabilities, and revision handling clearly.
- Cloud providers differ heavily. Capability flags are required to avoid pretending every backend supports the same operations.
- Conflict handling can grow large. v1 should define conflict signals, not a full merge UI.

## Open Questions

- Should the adapter contract live in `@floatboat/nexus-core` as types only, or in a new package?
- Should delete prefer trash semantics when supported, or should trash be a separate optional capability?
- How much of last-vault/recent-vault persistence belongs in the adapter versus host UI state?
