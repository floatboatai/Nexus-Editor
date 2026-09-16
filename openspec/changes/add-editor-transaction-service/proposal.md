# Change: Provide the editor transaction service to plugins

## Why
`openspec/changes/archive/2026-08-13-add-plugin-platform-api/acceptance-traceability.md:55`
marks `plugin-editor-extensions` as **已验证**, but the transaction evidence cited at
`:316-317` is only `CORE-TX` (core-level unit tests). The runtime side was never
implemented, so `nexus.editor-transactions` is a declared contract with a ready engine
and no host wiring: a plugin that declares the capability fails to load with
`capability-unsupported`. This change wires the runtime and the reference host, which is
what the archived acceptance record already claims.

## What Changes
- **ADDED** `EditorTransactionPipeline` / `EditorTransactionPipelineOptions`
  (`packages/plugin-runtime`) — an owner-scoped service per attached editor that
  registers commit filters and post-commit update listeners and dispatches transactions
  with a caller-supplied or generated `operationId`.
- **ADDED** the reference host registers a `nexus.editor-transactions` provider inside
  `attachEditor` (`apps/electron-demo`) and revokes/disposes it on detach.
- **ADDED** the package README and a "事务过滤与更新监听" section in the native plugin API
  guide.

## Impact
- Affected specs: plugin-editor-extensions
- Affected code: `packages/plugin-runtime/src/editor-transaction-pipeline.ts`,
  `packages/plugin-runtime/src/editor-transaction-adapters.ts`,
  `packages/plugin-runtime/src/index.ts`,
  `packages/plugin-runtime/api/public-exports.json`,
  `apps/electron-demo/src/renderer/plugin-runtime-host.ts`
- **No breaking changes**: two new non-breaking exports (a class and its options type);
  `packages/core`, `packages/plugin-api` and the existing registries are untouched.
