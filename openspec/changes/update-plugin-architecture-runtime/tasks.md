## 1. Core plugin architecture

- [x] 1.1 Add lifecycle setup contract to `NexusPlugin` and context types.
- [x] 1.2 Add dependency ordering support with `dependsOn`.
- [x] 1.3 Add structured plugin diagnostics collection and querying.
- [x] 1.4 Add command/event bus APIs on `EditorAPI`.
- [x] 1.5 Add runtime plugin management APIs (`getActivePlugins`, `usePlugin`, `unusePlugin`, `reloadPlugin`).
- [x] 1.6 Implement runtime setup/teardown orchestration and setup-scoped auto cleanup.

## 2. Plugin compatibility and integration

- [x] 2.1 Keep static plugin contribution model backward-compatible.
- [x] 2.2 Migrate `plugin-wordcount` to lifecycle setup path while preserving legacy attach helper.
- [x] 2.3 Update electron demo integration to lifecycle-based wordcount attachment.

## 3. Tests and docs

- [x] 3.1 Add/extend core tests for lifecycle, dependency ordering, diagnostics, buses, and runtime management.
- [x] 3.2 Add plugin-focused runtime tests for `plugin-wordcount` activation and unload cleanup.
- [x] 3.3 Update public docs (`README.md`, `README.zh.md`, `packages/core/README.md`, `packages/plugin-wordcount/README.md`) for the new plugin architecture APIs.
