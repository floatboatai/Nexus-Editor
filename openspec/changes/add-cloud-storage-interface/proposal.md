# Change: Add Cloud Storage Interface

## Why

The electron demo already has a vault workflow backed by local filesystem IPC, but that implementation is host-specific and cannot be reused by web, mobile, iframe, or cloud-backed hosts. Roadmap #23 calls for a cloud storage interface so Nexus can describe note/vault IO through a stable adapter contract while leaving concrete storage backends to the host.

## Goals

- Define a minimal `NoteVault` / storage adapter contract for listing, reading, writing, creating, renaming, deleting, and watching note-like resources.
- Keep storage backend ownership with the host. Nexus defines the contract; hosts provide local filesystem, WebDAV, S3, Dropbox, Google Drive, IndexedDB, or custom implementations.
- Preserve the existing editor-core headless model. The editor should not directly authenticate to cloud services or bundle provider SDKs.
- Provide enough contract detail for future implementation PRs to refactor the electron demo vault behind the same interface.
- Define test expectations for adapter contract behavior, boundary/security checks, and error semantics before runtime code is written.

## What Changes

This proposal phase changes only documentation/spec files:

- Add `openspec/changes/add-cloud-storage-interface/proposal.md`.
- Add `openspec/changes/add-cloud-storage-interface/design.md`.
- Add `openspec/changes/add-cloud-storage-interface/tasks.md`.
- Add `openspec/changes/add-cloud-storage-interface/specs/storage-interface/spec.md`.
- Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md` to mark Roadmap #23 as `in-progress` and link this change id.

The later implementation phase is expected to affect:

- `packages/core/src/types.ts` or a focused core module for exported adapter types.
- `packages/core/test/*` for adapter contract tests if the contract lands in core.
- `apps/electron-demo/electron/*` and `apps/electron-demo/src/renderer/*` if the existing vault IPC is adapted to the new contract.
- README/package docs for public API usage.

## Non-Goals

- No runtime code in this proposal PR.
- No bundled cloud provider SDKs in v1.
- No Google Drive, Dropbox, S3, WebDAV, or sync server implementation in v1.
- No auth/token refresh UI.
- No cross-device conflict resolution UI beyond defining required adapter conflict/error signals.
- No version history snapshots; Roadmap #19 owns that.
- No realtime collaboration; Roadmap #18 owns that.

## Impact

- Affected specs: `storage-interface` (new capability)
- Affected roadmap rows: #23 in English and Chinese roadmap files
- Runtime impact in this proposal phase: none
- Dependency impact in this proposal phase: none
- Backwards compatibility: existing local file and vault flows remain unchanged until a later implementation PR
